/**
 * `migrations: 'auto'` applies the constraints and indexes declared in a
 * table's extra config, not only its columns:
 *
 *   - column `.unique()`, table `unique().on(...)`  → UNIQUE in CREATE TABLE
 *   - `check(...)`                                  → CHECK in CREATE TABLE
 *   - `index()` / `uniqueIndex()` (+ `.where()`)    → CREATE INDEX IF NOT EXISTS,
 *     re-run on every boot so tables created earlier still receive them
 *
 * Runs on sqlite and PGlite (pg flavor). Set PG_TEST_URL to also run the
 * matrix against a real Postgres.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, afterEach } from 'node:test';
import { sql } from 'drizzle-orm';
import * as sqliteCore from 'drizzle-orm/sqlite-core';
import * as pgCore from 'drizzle-orm/pg-core';
import { GameDatabase, columns, tables } from '../src/index.ts';
import { rawQuery } from './backends.ts';

type Flavor = 'sqlite' | 'pg';

interface Backend {
  name: string;
  flavor: Flavor;
  /** Same physical store across calls, so a second boot sees the first one's tables. */
  newDb(schemas: Record<string, any>): GameDatabase<any, any, any>;
  cleanup(): Promise<void>;
}

function sqliteBackend(): Backend {
  const dbPath = path.join(os.tmpdir(), `colyseus-constraints-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  const open: GameDatabase[] = [];
  return {
    name: 'sqlite',
    flavor: 'sqlite',
    newDb(schemas) {
      const db = new GameDatabase({ connectionString: dbPath, schemas: schemas as any });
      open.push(db);
      return db;
    },
    async cleanup() {
      for (const db of open) { await db.shutdown(); }
      for (const ext of ['', '-shm', '-wal']) { try { fs.unlinkSync(dbPath + ext); } catch { /* ignore */ } }
    },
  };
}

function pgliteBackend(): Backend {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'colyseus-constraints-pglite-'));
  const open: GameDatabase[] = [];
  return {
    name: 'pglite',
    flavor: 'pg',
    newDb(schemas) {
      const db = new GameDatabase({ dialect: 'pglite', connectionString: `pglite://${dataDir}`, schemas: schemas as any });
      open.push(db);
      return db;
    },
    async cleanup() {
      for (const db of open) { await db.shutdown(); }
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

function postgresBackend(url: string): Backend {
  const open: GameDatabase[] = [];
  return {
    name: 'postgres',
    flavor: 'pg',
    newDb(schemas) {
      const db = new GameDatabase({ dialect: 'pg', connectionString: url, schemas: schemas as any });
      open.push(db);
      return db;
    },
    async cleanup() {
      for (const d of open) { await d.shutdown(); }
      // Drop what the suite created so reruns start clean; a fresh connection,
      // since the test may already have shut the others down.
      const janitor = new GameDatabase({ dialect: 'pg', connectionString: url, migrations: 'skip' });
      await janitor.boot();
      for (const t of ['players', 'colyseus_users', 'colyseus_configs', 'colyseus_cloud_saves', 'colyseus_leaderboards',
        'colyseus_leaderboard_entries', 'colyseus_analytics_events', 'colyseus_roles', 'colyseus_user_notes', 'colyseus_admin_audit']) {
        await (janitor as any).ownedConnection.unsafe(`DROP TABLE IF EXISTS "${t}" CASCADE`);
      }
      await janitor.shutdown();
    },
  };
}

const BACKENDS: Array<() => Backend> = [sqliteBackend, pgliteBackend];
if (process.env.PG_TEST_URL) { BACKENDS.push(() => postgresBackend(process.env.PG_TEST_URL!)); }

/** drizzle wraps driver errors in DrizzleQueryError; the constraint name lives on `cause`. */
async function rejectsWith(promise: Promise<unknown>, pattern: RegExp): Promise<void> {
  await assert.rejects(promise, (err: any) => {
    const message = `${err?.cause?.message ?? ''} ${err?.message ?? ''}`;
    assert.match(message, pattern);
    return true;
  });
}

async function listIndexes(db: GameDatabase, table: string): Promise<string[]> {
  const rows = db.dialect === 'pg'
    ? await rawQuery(db, `SELECT indexname AS name FROM pg_indexes WHERE tablename = '${table}'`)
    : await rawQuery(db, `SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = '${table}'`);
  return rows.map((r: any) => r.name).sort();
}

/** The `users` table from the docs: handle + case-insensitive uniqueness. */
function playersSchema(flavor: Flavor, withIndexes = true) {
  const core: any = flavor === 'pg' ? pgCore : sqliteCore;
  const base = flavor === 'pg' ? columns.pg.users : columns.sqlite.users;
  const table = flavor === 'pg' ? pgCore.pgTable : sqliteCore.sqliteTable;
  return table('players', {
    ...base,
    handle: core.text('handle').notNull(),
    handleLower: core.text('handle_lower').notNull(),
    nick: core.text('nick').unique(),
    region: core.text('region'),
  }, (t: any) => [
    ...(withIndexes ? [
      core.uniqueIndex('players_handle_lower_idx').on(t.handleLower),
      core.index('players_region_idx').on(t.region).where(sql`${t.region} is not null`),
    ] : []),
    core.check('players_handle_lower_chk', sql`${t.handleLower} = lower(${t.handle})`),
    core.check('players_handle_len_chk', sql`length(${t.handle}) >= ${3}`),
    core.unique('players_email_region_uq').on(t.email, t.region),
  ]);
}

for (const makeBackend of BACKENDS) {
  let backend: Backend;
  describe(`auto migrations: constraints + indexes (${makeBackend().name})`, () => {
    afterEach(async () => { await backend?.cleanup(); });

    it('applies UNIQUE, CHECK and indexes at CREATE TABLE, and rejects violating rows', async () => {
      backend = makeBackend();
      const users = playersSchema(backend.flavor);
      const db = backend.newDb({ users });
      await db.boot();

      const insert = (row: Record<string, any>) => db.drizzle.insert(users).values(row as any);
      await insert({ id: 'u1', email: 'a@b.c', handle: 'JohnSmith', handleLower: 'johnsmith', nick: 'js', region: 'eu' });

      // uniqueIndex on handle_lower
      await rejectsWith(insert({ id: 'u2', handle: 'johnSmith', handleLower: 'johnsmith' }), /unique|duplicate/i);
      // column-level .unique() on nick
      await rejectsWith(insert({ id: 'u3', handle: 'Other', handleLower: 'other', nick: 'js' }), /unique|duplicate/i);
      // table-level unique().on(email, region)
      await rejectsWith(insert({ id: 'u4', email: 'a@b.c', handle: 'Third', handleLower: 'third', region: 'eu' }), /unique|duplicate/i);
      // check: handle_lower must equal lower(handle)
      await rejectsWith(insert({ id: 'u5', handle: 'Mismatch', handleLower: 'nope' }), /check/i);
      // check: length(handle) >= 3 (inlined param)
      await rejectsWith(insert({ id: 'u6', handle: 'ab', handleLower: 'ab' }), /check/i);
      // a valid second row still goes in
      await insert({ id: 'u7', email: 'a@b.c', handle: 'Fourth', handleLower: 'fourth', region: 'us' });

      const indexes = await listIndexes(db, 'players');
      assert.ok(indexes.includes('players_handle_lower_idx'), `indexes: ${indexes}`);
      assert.ok(indexes.includes('players_region_idx'), `indexes: ${indexes}`);
    });

    it('is idempotent: a second boot against the same store succeeds', async () => {
      backend = makeBackend();
      const users = playersSchema(backend.flavor);
      const first = backend.newDb({ users });
      await first.boot();
      await first.shutdown();

      const second = backend.newDb({ users });
      await second.boot();
      const indexes = await listIndexes(second, 'players');
      assert.ok(indexes.includes('players_handle_lower_idx') && indexes.includes('players_region_idx'), `indexes: ${indexes}`);
    });

    it('adds indexes declared after the table was created', async () => {
      backend = makeBackend();
      const before = backend.newDb({ users: playersSchema(backend.flavor, false) });
      await before.boot();
      assert.ok(!(await listIndexes(before, 'players')).includes('players_handle_lower_idx'));
      await before.shutdown();

      const after = backend.newDb({ users: playersSchema(backend.flavor, true) });
      await after.boot();
      const indexes = await listIndexes(after, 'players');
      assert.ok(indexes.includes('players_handle_lower_idx'), `indexes after upgrade: ${indexes}`);
      // ...and the unique index is enforced on the pre-existing table
      await after.drizzle.insert(after.tables.users).values({ id: 'u1', handle: 'Ann', handleLower: 'ann' } as any);
      await rejectsWith(
        after.drizzle.insert(after.tables.users).values({ id: 'u2', handle: 'ANN', handleLower: 'ann' } as any),
        /unique|duplicate/i,
      );
    });

    it('factory third argument: tables.<dialect>.users(name, extras, extraConfig)', async () => {
      backend = makeBackend();
      const core: any = backend.flavor === 'pg' ? pgCore : sqliteCore;
      const factory: any = backend.flavor === 'pg' ? tables.pg : tables.sqlite;
      const users = factory.users('players', {
        handle: core.text('handle').notNull(),
        handleLower: core.text('handle_lower').notNull(),
      }, (t: any) => [
        core.uniqueIndex('players_handle_lower_idx').on(t.handleLower),
        core.check('players_handle_lower_chk', sql`${t.handleLower} = lower(${t.handle})`),
      ]);
      // composite-PK tables keep their PK and gain the extra index
      const cloudSaves = factory.cloudSaves('colyseus_cloud_saves', { tag: core.text('tag') }, (t: any) => [
        core.index('saves_tag_idx').on(t.tag),
      ]);
      const db = backend.newDb({ users, cloudSaves });
      await db.boot();

      await db.drizzle.insert(users).values({ id: 'u1', handle: 'Ann', handleLower: 'ann' });
      await rejectsWith(db.drizzle.insert(users).values({ id: 'u2', handle: 'ANN', handleLower: 'ann' }), /unique|duplicate/i);
      await rejectsWith(db.drizzle.insert(users).values({ id: 'u3', handle: 'Bob', handleLower: 'nope' }), /check/i);

      await db.saves.save('u1', { hp: 1 });
      await db.drizzle.insert(cloudSaves).values({ userId: 'u1', slot: 1, data: { hp: 2 } as any, tag: 'x' });
      await rejectsWith(
        db.drizzle.insert(cloudSaves).values({ userId: 'u1', slot: 1, data: { hp: 3 } as any }),
        /UNIQUE|primary key|duplicate/i,
      );
      assert.ok((await listIndexes(db, 'colyseus_cloud_saves')).includes('saves_tag_idx'));
    });
  });
}

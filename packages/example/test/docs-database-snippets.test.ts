/**
 * Smoke tests for the code snippets on docs.colyseus.io/database and its four
 * sub-pages. Each test runs a docs block (copied, not paraphrased) and asserts
 * the behavior the prose promises. Lives in `packages/example` because the
 * snippets pull in database, auth, core, tools, sdk and schema, and this is
 * the one workspace package that resolves all of them.
 *
 *   pnpm exec tsx --test --test-force-exit --test-timeout=60000 test/docs-database-snippets.test.ts
 *
 * Optional: PG_TEST_URL=postgres://localhost:5432/<db> also runs the schema
 * page against a real Postgres. Redis on localhost:6379 enables the
 * RedisPresence config-invalidation case.
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || 'docs-smoke-secret';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'docs-smoke-session';
process.env.INVITE_CODE = 'letmein';
process.env.NODE_ENV = 'test';

import assert from 'node:assert';
import { describe, it, before, after, afterEach } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { sqliteTable, text, integer, uniqueIndex, check } from 'drizzle-orm/sqlite-core';
import * as pgCore from 'drizzle-orm/pg-core';
import { z } from 'zod';

const { GameDatabase, DatabaseDriver, VersionConflictError, defineConfigs, tables, columns,
  CloudSavesPlugin, LeaderboardsPlugin, AnalyticsPlugin } = await import('@colyseus/database');
const { DatabaseDriver: DatabaseDriverSubpath } = await import('@colyseus/database/driver');
const { defineServer, defineRoom, Room, definePlugins, LocalPresence } = await import('@colyseus/core'); // the `colyseus` bundle re-exports these
const { listen } = await import('@colyseus/tools');
const { auth, JWT } = await import('@colyseus/auth');
const { RedisPresence } = await import('@colyseus/redis-presence');
const { schema, t } = await import('@colyseus/schema');
const { Client } = await import('@colyseus/sdk');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-database-'));
const cwdBefore = process.cwd();
process.chdir(tmp); // `new GameDatabase()` and `pglite://./data` write relative to cwd

const tmpFile = (name: string) => path.join(tmp, name);
let counter = 0;
const uniqueEmail = () => `user${++counter}-${Date.now()}@example.com`;

/** drizzle wraps driver errors; the constraint name lives on `cause`. */
async function rejectsWith(promise: Promise<unknown>, pattern: RegExp) {
  await assert.rejects(promise, (err: any) => {
    assert.match(`${err?.cause?.message ?? ''} ${err?.message ?? ''}`, pattern);
    return true;
  });
}

async function redisAvailable(): Promise<boolean> {
  const net = await import('node:net');
  return new Promise((resolve) => {
    const socket = net.connect({ port: 6379, host: '127.0.0.1' });
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => resolve(false));
  });
}

/** Real Postgres keeps state between tests; drop everything a boot may have created. */
async function dropAllPg(pdb: any) {
  const conn = pdb.rawClient;
  if (typeof conn?.unsafe !== 'function') { return; }
  for (const t of ['colyseus_users', 'colyseus_configs', 'colyseus_cloud_saves', 'colyseus_leaderboards', 'colyseus_leaderboard_entries',
    'colyseus_analytics_events', 'colyseus_roles', 'colyseus_user_notes', 'colyseus_admin_audit', 'colyseus_room_caches', '__drizzle_migrations']) {
    await conn.unsafe(`DROP TABLE IF EXISTS "${t}" CASCADE`);
  }
  await conn.unsafe('DROP SCHEMA IF EXISTS drizzle CASCADE');
}

// ---------------------------------------------------------------------------
// One server for the pages that need a running Colyseus process.
// ---------------------------------------------------------------------------

// database.mdx — "Quick start"
export const db = new GameDatabase({
  connectionString: process.env.DATABASE_URL, // undefined → sqlite, default file colyseus.db
});

// services.mdx — "Live configs"
const configs = defineConfigs({
  matchmaking: z.object({
    minPlayers: z.number().int().default(2),
    maxPlayers: z.number().int().default(10),
  }).prefault({}), // no row yet: parse {} so the field defaults fill in
});

const Player = schema({ hp: t.number(), level: t.number(), score: t.number() });
const GameState = schema({ players: t.map(Player) });

// database.mdx — "Quick start" room
class MyRoom extends Room<any> {
  state = new GameState();
  static seen: Record<string, any> = {};
  async onJoin(client: any, options: any) {
    // client.auth was populated by the default static onAuth,
    // which already rejects banned/revoked tokens automatically.
    MyRoom.seen[client.sessionId] = { auth: client.auth, save: await db.saves.load(client.auth.id) };
  }
}

// services.mdx — "Room plugins"
class SavesRoom extends Room<any> {
  state = new GameState();
  plugins = definePlugins([
    new CloudSavesPlugin({
      database: db,
      onJoin: 'none',  // load after this room creates the player (see onJoin below)
      onLeave: 'none', // save before this room removes it (see onLeave below)
      payload: (room, client) => room.state.players.get(client.sessionId).toJSON(),
      apply: (room, client, data) => room.state.players.get(client.sessionId).assign(data),
    }),
    new LeaderboardsPlugin({ database: db, boardId: 'arena', submitOn: 'none' }),
    new AnalyticsPlugin({ database: db, prefix: 'arena', track: ['join', 'leave'] }),
  ]);

  onCreate() {
    this.onMessage('set', (client, data) => this.state.players.get(client.sessionId).assign(data));
  }

  async onJoin(client: any) {
    this.state.players.set(client.sessionId, new Player({ hp: 100, level: 1, score: 0 }));
    await this.plugins.cloudSaves.manualLoad(client);
  }

  async onLeave(client: any) {
    const player = this.state.players.get(client.sessionId);
    await this.plugins.cloudSaves.manualSave(client);
    await this.plugins.leaderboards.submitScore(client, player.score);
    this.state.players.delete(client.sessionId);
  }
}

let base: string;
let wsBase: string;
let server: any;

before(async () => {
  const port = 2700 + Math.floor(Math.random() * 200);
  server = defineServer({
    database: db, // ← wires @colyseus/auth routes + user store automatically
    driver: new DatabaseDriver(), // adopts the GameDatabase connection
    greet: false,
    gracefullyShutdown: false,
    rooms: {
      my_room: defineRoom(MyRoom),
      saves_room: defineRoom(SavesRoom),
    },
  });
  // authentication.mdx — "Customizing callbacks" (after listen())
  await listen(server, port).then(() => {
    const original = auth.settings.onRegisterWithEmailAndPassword;
    auth.settings.onRegisterWithEmailAndPassword = async (email, password, options) => {
      if (options.inviteCode !== process.env.INVITE_CODE) {
        throw new Error('invalid invite code');
      }
      return original(email, password, options);
    };
  });
  base = `http://127.0.0.1:${port}`;
  wsBase = `ws://127.0.0.1:${port}`;
  revocationCheck = JWT.settings.revocationCheck;
});

// Every GameDatabase.boot() reassigns the process-global JWT revocation check
// (and the constructor sets `GameDatabase.current`) to the newest instance, so
// the throwaway databases some tests boot would hijack the live server's joins.
// Restore the server's after each test. (TODO/source-bugs-0.18.md)
let revocationCheck: any;
function restoreGlobals() {
  JWT.settings.revocationCheck = revocationCheck;
  (GameDatabase as any).current = db;
}

after(async () => {
  await server.gracefullyShutdown(false);
  await db.shutdown();
  process.chdir(cwdBefore);
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// database.mdx
// ---------------------------------------------------------------------------

describe('database.mdx', () => {
  afterEach(restoreGlobals);

  it('quick start: defineServer({ database }) boots the DB and mounts /auth; client.auth.id reaches onJoin', async () => {
    assert.ok(fs.existsSync(tmpFile('colyseus.db')), 'default sqlite file colyseus.db');
    const sdk = new Client(wsBase);
    const { user, token } = await sdk.auth.signInAnonymously();
    assert.ok(user.id && token);
    await db.saves.save(user.id, { hp: 42 });
    const room = await sdk.joinOrCreate('my_room');
    const seen = MyRoom.seen[room.sessionId];
    assert.equal(seen.auth.id, user.id);
    assert.deepEqual(seen.save.data, { hp: 42 });
    await room.leave();
  });

  it('dialects: omitted → colyseus.db, ./game.db, :memory:, pglite:// (auto-detected and explicit)', async () => {
    const a = new GameDatabase();
    await a.boot(); await a.shutdown();
    assert.equal(a.dialect, 'sqlite');

    const b = new GameDatabase({ connectionString: './game.db' });
    await b.boot(); await b.shutdown();
    assert.ok(fs.existsSync(tmpFile('game.db')));

    const c = new GameDatabase({ connectionString: ':memory:' });
    await c.boot();
    await c.saves.save('u', { ok: true });
    assert.deepEqual((await c.saves.load('u'))!.data, { ok: true });
    await c.shutdown();

    const d = new GameDatabase({ dialect: 'pglite', connectionString: 'pglite://./data' });
    await d.boot();
    assert.equal(d.dialect, 'pg');
    assert.ok(fs.existsSync(tmpFile('data')), 'pglite dataDir ./data');
    await d.shutdown();

    const e = new GameDatabase({ connectionString: 'pglite://:memory:' });
    await e.boot();
    assert.equal(e.dialect, 'pg');
    await e.shutdown();
  });

  it('migrations: "skip" creates nothing; { files } runs drizzle migration dirs', async () => {
    const skip = new GameDatabase({ connectionString: ':memory:', migrations: 'skip' });
    await skip.boot();
    const rows = (skip as any).rawClient.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all();
    assert.equal(rows.length, 0);
    await skip.shutdown();

    const folder = tmpFile('drizzle');
    fs.mkdirSync(path.join(folder, '20260101000000_initial'), { recursive: true });
    fs.writeFileSync(path.join(folder, '20260101000000_initial', 'migration.sql'),
      `CREATE TABLE "colyseus_configs" ("key" text PRIMARY KEY, "value" text, "version" integer NOT NULL DEFAULT 1, "updated_at" integer NOT NULL DEFAULT (unixepoch()));`);
    const files = new GameDatabase({ connectionString: tmpFile('files.db'), migrations: { files: './drizzle' } });
    await files.boot();
    await files.configs.set('k', { v: 1 });
    assert.deepEqual(await files.configs.get('k'), { v: 1 });
    const names = (files as any).rawClient.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'colyseus_%'`).all().map((r: any) => r.name);
    assert.deepEqual(names, ['colyseus_configs'], 'only what the migration file created');
    await files.shutdown();
  });

  it('bring your own connection: `db` is adopted for schema work, and shutdown() leaves it open', async () => {
    // The docs snippet builds the instance with drizzle-orm/node-postgres; the
    // shape under test is the `db` option itself, so this runs the sqlite
    // driver that ships with node. The verbatim `pg` + node-postgres snippet
    // runs against Postgres.app from a standalone npm project (see the
    // admin-docs-harness memory: scratchpad pg-smoke/), since `pg` is not a
    // workspace dependency.
    const { drizzle: nodeSqlite } = await import('drizzle-orm/node-sqlite');
    const instance: any = nodeSqlite({ connection: { path: tmpFile('byo.db') } });

    const byo = new GameDatabase({ db: instance });
    await byo.boot(); // default migrations: "auto" — the adopted client does the DDL
    await byo.configs.set('k', { v: 1 });
    assert.deepEqual(await byo.configs.get('k'), { v: 1 });

    await byo.shutdown();
    assert.deepEqual(instance.$client.prepare('SELECT 1 AS ok').all(), [{ ok: 1 }],
      'the connection we did not open stays open');
    instance.$client.close();
  });

  it('matchmaking driver: the server\'s rooms are stored in colyseus_room_caches on the shared connection', async () => {
    const sdk = new Client(wsBase);
    await sdk.auth.signInAnonymously();
    const room = await sdk.joinOrCreate('my_room');
    const rows = (db as any).rawClient.prepare(`SELECT room_id, name, clients FROM colyseus_room_caches WHERE room_id = ?`).all(room.roomId);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].name, 'my_room');
    assert.equal(rows[0].clients, 1);
    await room.leave();
    await new Promise((r) => setTimeout(r, 200));
    const after = (db as any).rawClient.prepare(`SELECT room_id FROM colyseus_room_caches WHERE room_id = ?`).all(room.roomId);
    assert.equal(after.length, 0, 'auto-disposed room removed from the cache');
  });

  it('matchmaking driver: bare new DatabaseDriver() and the ./driver subpath both adopt GameDatabase.current', async () => {
    const driver = new DatabaseDriver();
    await driver.boot();
    const driver2 = new DatabaseDriverSubpath();
    await driver2.boot();
    assert.equal(await driver.has('nope'), false);
  });

  it('matchmaking driver: custom room-cache table via tables.sqlite.roomCaches (schema only; binds to the current GameDatabase)', async () => {
    const db2 = new GameDatabase({ connectionString: tmpFile('driver-schema.db') });
    const roomCaches = tables.sqlite.roomCaches('colyseus_room_caches', {
      region: text('region'),
    });
    const driver = new DatabaseDriver({ schema: roomCaches });
    await driver.boot();
    await driver.persist({ roomId: 'r1', processId: 'p1', name: 'arena', clients: 0, maxClients: 4, locked: false, private: false, unlisted: false, metadata: { mode: 'ranked' }, region: 'eu' } as any, true);
    const row: any = await driver.findOne({ roomId: 'r1' });
    assert.equal(row.region, 'eu');
    assert.deepEqual(row.metadata, { mode: 'ranked' });
    assert.equal((await driver.query({ region: 'eu' } as any)).length, 1);
    assert.equal((await driver.query({ mode: 'ranked' } as any)).length, 1); // non-column fields match against metadata
    const cols = (db2 as any).rawClient.prepare(`SELECT name FROM pragma_table_info('colyseus_room_caches')`).all().map((r: any) => r.name);
    assert.ok(cols.includes('region'));
    await driver.remove('r1');
    await db2.shutdown();
  });

  for (const [label, opts] of [['pglite', () => ({ connectionString: 'pglite://:memory:' })], ...(process.env.PG_TEST_URL ? [['postgres', () => ({ connectionString: process.env.PG_TEST_URL })]] : [])] as Array<[string, () => any]>) {
    it(`[${label}] matchmaking driver: custom room-cache table via tables.pg.roomCaches`, async () => {
      const pdb = new GameDatabase(opts());
      const roomCaches = tables.pg.roomCaches('colyseus_room_caches', {
        region: pgCore.text('region'),
      });
      const driver = new DatabaseDriver({ schema: roomCaches });
      await driver.boot();
      try {
        await driver.persist({ roomId: 'r1', processId: 'p1', name: 'arena', clients: 0, maxClients: 4, locked: false, private: false, unlisted: false, metadata: { mode: 'ranked' }, region: 'eu' } as any, true);
        const row: any = await driver.findOne({ roomId: 'r1' });
        assert.equal(row.region, 'eu');
        assert.equal((await driver.query({ region: 'eu' } as any)).length, 1);
        assert.equal((await driver.query({ mode: 'ranked' } as any)).length, 1);
        await driver.remove('r1');
      } finally {
        await dropAllPg(pdb);
        await pdb.shutdown();
      }
    });
  }

  it('matchmaking driver: raw drizzle mode without a GameDatabase', async () => {
    const { drizzle } = await import('drizzle-orm/node-sqlite');
    const sdb = drizzle({ connection: { path: tmpFile('raw-driver.db') } });
    const driver = new DatabaseDriver({ drizzle: sdb, dialect: 'sqlite' });
    await driver.boot();
    await driver.persist({ roomId: 'r2', processId: 'p1', name: 'arena', clients: 1, maxClients: 4, locked: false, private: false, unlisted: false, metadata: {} } as any, true);
    assert.equal(await driver.has('r2'), true);
    await driver.shutdown(); // closeOnShutdown defaults to true in raw mode
    assert.throws(() => (sdb as any).$client.prepare('SELECT 1').get(), /not open/i);
  });
});

// ---------------------------------------------------------------------------
// database/authentication.mdx
// ---------------------------------------------------------------------------

describe('database/authentication.mdx', () => {
  afterEach(restoreGlobals);

  it('routes are mounted: register + login over HTTP, /auth/userdata with the token', async () => {
    const email = uniqueEmail();
    const reg = await fetch(`${base}/auth/register`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'hunter22', options: { inviteCode: 'letmein' } }),
    });
    assert.equal(reg.status, 200, await reg.text());
    const login = await (await fetch(`${base}/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'hunter22' }),
    })).json();
    assert.ok(login.token);
    assert.equal(login.user.email, email);
    assert.equal(login.user.password, undefined, 'hash never leaves the server');
    const me = await fetch(`${base}/auth/userdata`, { headers: { authorization: `Bearer ${login.token}` } });
    assert.equal(me.status, 200);
  });

  it('customizing callbacks: the wrapper installed after listen() rejects a bad invite code', async () => {
    const sdk = new Client(wsBase);
    await assert.rejects(
      sdk.auth.registerWithEmailAndPassword(uniqueEmail(), 'hunter22', { inviteCode: 'wrong' }),
      /invalid invite code/,
    );
    const ok = await sdk.auth.registerWithEmailAndPassword(uniqueEmail(), 'hunter22', { inviteCode: 'letmein' });
    assert.ok(ok.token);
  });

  it('admin helpers: ban() → login answers 403 { reason, until }; isBanned(); unban()', async () => {
    const email = uniqueEmail();
    const sdk = new Client(wsBase);
    const { user } = await sdk.auth.registerWithEmailAndPassword(email, 'hunter22', { inviteCode: 'letmein' });
    const userId = user.id;

    await db.auth.ban(userId, { reason: 'cheating', until: new Date(Date.now() + 86_400_000) });
    const status = await db.auth.isBanned(userId); // { banned, reason?, until? }
    assert.equal(status.banned, true);
    assert.equal((status as any).reason, 'cheating');

    const res = await fetch(`${base}/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'hunter22' }),
    });
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.error, 'banned');
    assert.equal(body.reason, 'cheating');
    assert.ok(body.until);

    await db.auth.unban(userId);
    assert.deepEqual(await db.auth.isBanned(userId), { banned: false });
    const again = await fetch(`${base}/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'hunter22' }),
    });
    assert.equal(again.status, 200);
  });

  it('bumpTokenVersion(): the old JWT still passes HTTP but is rejected on the next room join', async () => {
    const sdk = new Client(wsBase);
    const { user, token } = await sdk.auth.signInAnonymously();
    const room = await sdk.joinOrCreate('my_room');
    await room.leave();

    await db.auth.bumpTokenVersion(user.id);

    const http = await fetch(`${base}/auth/userdata`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(http.status, 200, 'HTTP routes verify only signature and expiry');
    await assert.rejects(sdk.joinOrCreate('my_room'), (err: any) => {
      assert.match(String(err?.message ?? err), /auth|4215|4212/i);
      return true;
    });
  });

  it('db.auth.settings is a fresh object per access; auth.settings is the singleton the routes read', () => {
    assert.notStrictEqual(db.auth.settings, db.auth.settings);
    assert.equal(typeof auth.settings.onCheckBanned, 'function', 'copied from db.auth.settings at listen()');
  });
});

// ---------------------------------------------------------------------------
// database/services.mdx
// ---------------------------------------------------------------------------

describe('database/services.mdx', () => {
  afterEach(restoreGlobals);

  it('cloud saves: save/load, optimistic locking with VersionConflictError, listSlots, delete', async () => {
    const userId = 'saves-u1';
    const newData = { hp: 50, level: 8 };

    // save(userId, data, slot = 0, expectedVersion?)
    const { version } = await db.saves.save(userId, { hp: 100, level: 7 });
    assert.equal(version, 1);

    const save = await db.saves.load(userId); // { data, version } | null
    assert.deepEqual(save, { data: { hp: 100, level: 7 }, version: 1 });

    // pass the expected version for optimistic locking
    const next = await db.saves.save(userId, newData, 0, version);
    assert.equal(next.version, 2);

    let conflict = false;
    try {
      await db.saves.save(userId, newData, 0, version); // stale: still 1
    } catch (e) {
      if (e instanceof VersionConflictError) { conflict = true; }
    }
    assert.ok(conflict, 'stale expectedVersion throws VersionConflictError');

    await db.saves.save(userId, { slot: 'two' }, 1);
    const slots = await db.saves.listSlots(userId); // [{ slot, version, updatedAt }]
    assert.deepEqual(slots.map((s) => s.slot).sort(), [0, 1]);
    assert.ok(slots[0].updatedAt instanceof Date);

    assert.equal(await db.saves.delete(userId), true); // delete slot 0 for this user
    assert.equal(await db.saves.load(userId), null);
    assert.ok(await db.saves.load(userId, 1));
  });

  it('leaderboards: ensure, keep-best submit, seasons, top, aroundMe', async () => {
    const userId = 'lb-me';
    await db.leaderboards.ensure('global', 'Global Leaderboard');
    await db.leaderboards.ensure('global', 'Global Leaderboard'); // idempotent
    await db.leaderboards.submit('global', userId, 1750);          // only kept if it beats the current best
    await db.leaderboards.submit('global', userId, 999, 'season-1'); // isolated per season
    await db.leaderboards.submit('global', userId, 100);            // lower: ignored
    for (let i = 0; i < 12; i++) { await db.leaderboards.submit('global', `lb-${i}`, 1000 + i * 100); }

    const top = await db.leaderboards.top('global', 10);
    assert.equal(top.length, 10);
    assert.equal(top[0].score, 2100);
    assert.ok(top.every((e, i) => i === 0 || e.score <= top[i - 1].score), 'sorted desc');

    const nearby = await db.leaderboards.aroundMe('global', userId, 5);
    const meIdx = nearby.findIndex((e) => e.userId === userId);
    assert.equal(nearby[meIdx].score, 1750, 'keep-best kept 1750, not 100');
    assert.ok(nearby.slice(0, meIdx).every((e) => e.score > 1750));
    assert.ok(nearby.slice(meIdx + 1).every((e) => e.score < 1750));

    const season = await db.leaderboards.top('global', 10, 'season-1');
    assert.deepEqual(season.map((e) => [e.userId, e.score]), [[userId, 999]]);
  });

  it('live configs: typed defaults with .prefault({}), validation on set, subscribe fires on set', async () => {
    const cfgDb = new GameDatabase({ connectionString: ':memory:', configsRegistry: configs });
    await cfgDb.boot();

    const mm = await cfgDb.configs.get('matchmaking'); // typed: { minPlayers, maxPlayers }
    assert.deepEqual(mm, { minPlayers: 2, maxPlayers: 10 });

    const seen: any[] = [];
    const unsubscribe = cfgDb.configs.subscribe('matchmaking', (value) => { seen.push(value); });
    await cfgDb.configs.set('matchmaking', { minPlayers: 4, maxPlayers: 10 });
    assert.deepEqual(seen, [{ minPlayers: 4, maxPlayers: 10 }]);
    unsubscribe();
    await cfgDb.configs.set('matchmaking', { minPlayers: 3, maxPlayers: 10 });
    assert.equal(seen.length, 1, 'unsubscribed');

    await assert.rejects(cfgDb.configs.set('matchmaking', { minPlayers: 'four' } as any), /validation failed/);
    await cfgDb.shutdown();
  });

  it('live configs: Zod 4 `.default({})` does NOT fill inner defaults (why the docs use .prefault)', async () => {
    const broken = defineConfigs({
      matchmaking: z.object({
        minPlayers: z.number().int().default(2),
      }).default({} as any),
    });
    const cfgDb = new GameDatabase({ connectionString: ':memory:', configsRegistry: broken });
    await cfgDb.boot();
    assert.deepEqual(await cfgDb.configs.get('matchmaking'), {});
    await cfgDb.shutdown();
  });

  it('live configs: a shared Presence invalidates the other instance and fires its subscribers', async () => {
    const presence = new LocalPresence();
    const a = new GameDatabase({ connectionString: tmpFile('cfg-shared.db'), configsRegistry: configs, presence });
    const b = new GameDatabase({ connectionString: tmpFile('cfg-shared.db'), configsRegistry: configs, presence });
    await a.boot(); await b.boot();
    await b.configs.get('matchmaking'); // warm b's cache
    const seen: any[] = [];
    b.configs.subscribe('matchmaking', (value) => { seen.push(value); });
    await a.configs.set('matchmaking', { minPlayers: 5, maxPlayers: 10 });
    await new Promise((r) => setTimeout(r, 50));
    assert.deepEqual(seen, [{ minPlayers: 5, maxPlayers: 10 }]);
    assert.deepEqual(await b.configs.get('matchmaking'), { minPlayers: 5, maxPlayers: 10 }, 'b cache refreshed');
    await a.shutdown(); await b.shutdown();
  });

  it('live configs: RedisPresence cross-instance (skipped without a local redis)', async (ctx) => {
    if (!(await redisAvailable())) { ctx.skip('no redis on 127.0.0.1:6379'); return; }
    const p1 = new RedisPresence();
    const p2 = new RedisPresence();
    const a = new GameDatabase({ connectionString: tmpFile('cfg-redis.db'), configsRegistry: configs, presence: p1 });
    const b = new GameDatabase({ connectionString: tmpFile('cfg-redis.db'), configsRegistry: configs, presence: p2 });
    await a.boot(); await b.boot();
    await new Promise((r) => setTimeout(r, 100)); // let the subscriptions settle
    const seen: any[] = [];
    b.configs.subscribe('matchmaking', (value) => { seen.push(value); });
    await a.configs.set('matchmaking', { minPlayers: 6, maxPlayers: 10 });
    await new Promise((r) => setTimeout(r, 200));
    assert.deepEqual(seen, [{ minPlayers: 6, maxPlayers: 10 }]);
    await a.shutdown(); await b.shutdown();
    await p1.shutdown(); await p2.shutdown();
  });

  it('analytics, moderation & notes', async () => {
    const userId = 'mod-u1';
    const authorId = 'admin-u1';
    await db.analytics.track('match_completed', userId, { mode: 'ranked', durationMs: 312_000 });
    const events = await db.drizzle.select().from(db.tables.analyticsEvents).where(eq(db.tables.analyticsEvents.name, 'match_completed'));
    assert.deepEqual(events[0].props, { mode: 'ranked', durationMs: 312_000 });

    await db.moderation.setRole(userId, 'mod');
    assert.equal(await db.moderation.can(userId, 'delete', 'guilds'), false); // boolean
    assert.equal(await db.moderation.can(userId, 'read', 'guilds'), false, 'mods act only on scoped collections');
    await db.moderation.assignMod(userId, 'guilds');    // mods act only on assigned collections
    assert.equal(await db.moderation.can(userId, 'read', 'guilds'), true);
    assert.equal(await db.moderation.can(userId, 'delete', 'guilds'), false, '"delete" is admin-only');

    await db.notes.add(userId, 'Refunded once on 2026-04-12', authorId);
    assert.equal((await db.notes.list(userId)).length, 1);
    await db.notes.deleteAllForUser(userId); // GDPR cleanup
    assert.equal((await db.notes.list(userId)).length, 0);
  });

  it('room plugins: CloudSavesPlugin restores on rejoin, LeaderboardsPlugin submitScore on leave, AnalyticsPlugin tracks join/leave', async () => {
    const sdk = new Client(wsBase);
    const { user } = await sdk.auth.signInAnonymously();
    const room = await sdk.joinOrCreate('saves_room');
    room.send('set', { hp: 37, level: 9, score: 4200 });
    await new Promise((r) => setTimeout(r, 100));
    await room.leave();
    await new Promise((r) => setTimeout(r, 300)); // onLeave → manualSave + submitScore

    const saved = await db.saves.load(user.id);
    assert.deepEqual(saved!.data, { hp: 37, level: 9, score: 4200 }, 'payload() persisted on leave');

    const room2 = await sdk.joinOrCreate('saves_room');
    await new Promise((r) => setTimeout(r, 200));
    // apply() restored the state on join: the room echoes it back on leave
    room2.send('set', { hp: 38 });
    await new Promise((r) => setTimeout(r, 100));
    await room2.leave();
    await new Promise((r) => setTimeout(r, 300));
    assert.deepEqual((await db.saves.load(user.id))!.data, { hp: 38, level: 9, score: 4200 });

    const top = await db.leaderboards.top('arena', 10);
    assert.ok(top.some((e) => e.userId === user.id && e.score === 4200), `submitScore on leave: ${JSON.stringify(top)}`);

    const events = await db.drizzle.select().from(db.tables.analyticsEvents).where(eq(db.tables.analyticsEvents.userId, user.id));
    const names = events.map((e: any) => e.name).sort();
    assert.deepEqual(names, ['arena.join', 'arena.join', 'arena.leave', 'arena.leave']);
  });
});

// ---------------------------------------------------------------------------
// database/schemas.mdx
// ---------------------------------------------------------------------------

describe('database/schemas.mdx', () => {
  afterEach(restoreGlobals);

  it('factory: tables.sqlite.users("colyseus_users", extras) keeps the built-in name and services return the custom columns', async () => {
    const users = tables.sqlite.users('colyseus_users', {
      displayName: text('display_name'),
      level: integer('level').notNull().default(1),
    });
    const sdb = new GameDatabase({ connectionString: ':memory:', schemas: { users } });
    await sdb.boot();
    const names = (sdb as any).rawClient.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name IN ('users','colyseus_users')`).all().map((r: any) => r.name);
    assert.deepEqual(names, ['colyseus_users']);

    const created = await sdb.auth.settings.onRegisterAnonymously!({}) as any;
    await sdb.drizzle.update(sdb.tables.users).set({ displayName: 'Alice' }).where(eq(sdb.tables.users.id, created.id));
    const [row] = await sdb.drizzle.select().from(sdb.tables.users).where(eq(sdb.tables.users.id, created.id));
    assert.equal(row.displayName, 'Alice');
    assert.equal(row.level, 1);
    assert.strictEqual(sdb.tables.users, users, 'db.tables.users is the resolved table');
    await sdb.shutdown();
  });

  it('factory: a different first argument creates a new physical table (the default one is not migrated)', async () => {
    const users = tables.sqlite.users('users', { displayName: text('display_name') });
    const sdb = new GameDatabase({ connectionString: ':memory:', schemas: { users } });
    await sdb.boot();
    const names = (sdb as any).rawClient.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name IN ('users','colyseus_users')`).all().map((r: any) => r.name);
    assert.deepEqual(names, ['users']);
    await sdb.shutdown();
  });

  it('constraints and indexes: handle + case-insensitive uniqueness via the factory third argument', async () => {
    const users = tables.sqlite.users('colyseus_users', {
      handle: text('handle'),
      handleLower: text('handle_lower'),
    }, (t) => [
      uniqueIndex('users_handle_lower_idx').on(t.handleLower),
      check('users_handle_lower_chk', sql`${t.handleLower} = lower(${t.handle})`),
    ]);
    const sdb = new GameDatabase({ connectionString: ':memory:', schemas: { users } });
    await sdb.boot();

    // built-in inserts still work: custom columns are nullable
    const a = await sdb.auth.settings.onRegisterAnonymously!({}) as any;
    const b = await sdb.auth.settings.onRegisterAnonymously!({}) as any;

    // writing the custom columns
    async function setHandle(userId: string, handle: string) {
      await sdb.drizzle.update(sdb.tables.users)
        .set({ handle, handleLower: handle.toLowerCase() })
        .where(eq(sdb.tables.users.id, userId));
    }
    await setHandle(a.id, 'JohnSmith');
    await rejectsWith(setHandle(b.id, 'johnsmith'), /unique/i);
    await rejectsWith(
      sdb.drizzle.update(sdb.tables.users).set({ handle: 'Foo', handleLower: 'bar' }).where(eq(sdb.tables.users.id, b.id)),
      /check/i,
    );
    await setHandle(b.id, 'JaneDoe');
    await sdb.shutdown();
  });

  it('constraints and indexes: the hand-rolled sqliteTable + columns.sqlite.users equivalent', async () => {
    const users = sqliteTable('colyseus_users', {
      ...columns.sqlite.users,
      handle: text('handle'),
      handleLower: text('handle_lower'),
    }, (t) => [
      uniqueIndex('users_handle_lower_idx').on(t.handleLower),
      check('users_handle_lower_chk', sql`${t.handleLower} = lower(${t.handle})`),
    ]);
    const sdb = new GameDatabase({ connectionString: ':memory:', schemas: { users } });
    await sdb.boot();
    await sdb.drizzle.insert(users).values({ id: 'u1', handle: 'Ann', handleLower: 'ann' });
    await rejectsWith(sdb.drizzle.insert(users).values({ id: 'u2', handle: 'ANN', handleLower: 'ann' }), /unique/i);
    const found = await sdb.auth.settings.onFindUserByEmail!('nobody@example.com');
    assert.equal(found, null, 'services still work on the hand-rolled table');
    await sdb.shutdown();
  });

  it('constraints and indexes: the pg twin on PGlite (and Postgres when PG_TEST_URL is set)', async () => {
    const users = tables.pg.users('colyseus_users', {
      handle: pgCore.text('handle'),
      handleLower: pgCore.text('handle_lower'),
    }, (t) => [
      pgCore.uniqueIndex('users_handle_lower_idx').on(t.handleLower),
      pgCore.check('users_handle_lower_chk', sql`${t.handleLower} = lower(${t.handle})`),
    ]);
    const targets: Array<[string, any]> = [['pglite', { connectionString: 'pglite://:memory:' }]];
    if (process.env.PG_TEST_URL) { targets.push(['postgres', { dialect: 'pg', connectionString: process.env.PG_TEST_URL }]); }
    for (const [label, opts] of targets) {
      const pdb = new GameDatabase({ ...opts, schemas: { users } });
      await pdb.boot();
      try {
        await pdb.drizzle.insert(users).values({ id: 'u1', handle: 'Ann', handleLower: 'ann' });
        await rejectsWith(pdb.drizzle.insert(users).values({ id: 'u2', handle: 'ANN', handleLower: 'ann' }), /unique|duplicate/i);
        await rejectsWith(pdb.drizzle.insert(users).values({ id: 'u3', handle: 'Bob', handleLower: 'nope' }), /check/i);
      } finally {
        await dropAllPg(pdb);
        await pdb.shutdown();
      }
    }
  });

  it('auto migrations add an index declared later, but never a constraint, to an existing table', async () => {
    const file = tmpFile('evolve.db');
    const v1 = new GameDatabase({ connectionString: file, schemas: { users: tables.sqlite.users('colyseus_users', { handle: text('handle') }) } });
    await v1.boot();
    await v1.drizzle.insert(v1.tables.users).values({ id: 'u1', handle: 'ann' });
    await v1.shutdown();

    const v2users = tables.sqlite.users('colyseus_users', {
      handle: text('handle'),
      nick: text('nick').unique(), // constraint: only applied when the table is created
    }, (t) => [uniqueIndex('users_handle_idx').on(t.handle)]); // index: applied on every boot
    const v2 = new GameDatabase({ connectionString: file, schemas: { users: v2users } });
    await v2.boot();
    await rejectsWith(v2.drizzle.insert(v2users).values({ id: 'u2', handle: 'ann' }), /unique/i);
    await v2.drizzle.insert(v2users).values({ id: 'u3', handle: 'bob', nick: 'x' });
    await v2.drizzle.insert(v2users).values({ id: 'u4', handle: 'cid', nick: 'x' }); // no UNIQUE on the existing table
    await v2.shutdown();
  });

  it('the Discord mistake: spreading the factory function gives a table with only the extras', async () => {
    const users = sqliteTable('users', {
      ...(tables.sqlite.users as any),
      handle: text('handle').notNull(),
    });
    const sdb = new GameDatabase({ connectionString: ':memory:', schemas: { users } });
    await sdb.boot(); // boots fine...
    await assert.rejects(sdb.auth.getTokenVersion('x'), /Cannot convert undefined or null to object/);
    await sdb.shutdown();
  });

  it('drizzle-kit: the schema barrel with sqlite-defaults + migrations: { files } boots the customized users table', async () => {
    const { execFileSync } = await import('node:child_process');
    const dir = tmpFile('dk');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'schema.ts'), `
import { tables } from "@colyseus/database";
import { text, uniqueIndex, check } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const users = tables.sqlite.users("colyseus_users", {
    handle: text("handle"),
    handleLower: text("handle_lower"),
}, (t) => [
    uniqueIndex("users_handle_lower_idx").on(t.handleLower),
    check("users_handle_lower_chk", sql\`\${t.handleLower} = lower(\${t.handle})\`),
]);

export {
    configs, cloudSaves, leaderboards, leaderboardEntries,
    analyticsEvents, roles, userNotes, adminAudit,
} from "@colyseus/database/sqlite-defaults";
`);
    fs.writeFileSync(path.join(dir, 'drizzle.config.ts'), `
import { defineConfig } from "drizzle-kit";

export default defineConfig({
    dialect: "sqlite",
    schema: "./schema.ts",
    out: "./drizzle",
    dbCredentials: { url: "./colyseus.db" },
});
`);
    // resolve packages from the example workspace, run drizzle-kit from the database package
    fs.symlinkSync(path.join(cwdBefore, 'node_modules'), path.join(dir, 'node_modules'));
    const drizzleKit = path.join(fs.realpathSync(path.join(cwdBefore, 'node_modules', '@colyseus', 'database')), 'node_modules', '.bin', 'drizzle-kit');
    execFileSync(drizzleKit, ['generate', '--config', 'drizzle.config.ts'], { cwd: dir, stdio: 'pipe' });
    const sqlFile = fs.readdirSync(path.join(dir, 'drizzle')).filter((d) => !d.startsWith('.')).map((d) => path.join(dir, 'drizzle', d, 'migration.sql'))[0];
    const ddl = fs.readFileSync(sqlFile, 'utf8');
    assert.match(ddl, /CREATE UNIQUE INDEX `users_handle_lower_idx`/);
    assert.match(ddl, /CHECK\("handle_lower" = lower\("handle"\)\)/);

    const schemaMod = await import(path.join(dir, 'schema.ts'));
    const mdb = new GameDatabase({ connectionString: path.join(dir, 'colyseus.db'), schemas: schemaMod, migrations: { files: path.join(dir, 'drizzle') } });
    await mdb.boot();
    await mdb.drizzle.insert(mdb.tables.users).values({ id: 'u1', handle: 'Ann', handleLower: 'ann' } as any);
    await rejectsWith(mdb.drizzle.insert(mdb.tables.users).values({ id: 'u2', handle: 'ANN', handleLower: 'ann' } as any), /unique/i);
    await mdb.saves.save('u1', { ok: 1 }); // the re-exported defaults were created too
    await mdb.shutdown();
  });
});

// ---------------------------------------------------------------------------
// database/schemas.mdx — PostgreSQL tabs (PGlite always; real Postgres with PG_TEST_URL)
// ---------------------------------------------------------------------------

describe('database/schemas.mdx (PostgreSQL tabs)', () => {
  afterEach(restoreGlobals);

  const targets: Array<[string, () => any]> = [['pglite', () => ({ connectionString: 'pglite://:memory:' })]];
  if (process.env.PG_TEST_URL) { targets.push(['postgres', () => ({ connectionString: process.env.PG_TEST_URL })]); }

  for (const [label, opts] of targets) {
    it(`[${label}] extending users: tables.pg.users + connectionString auto-detects the dialect`, async () => {
      const users = tables.pg.users('colyseus_users', {
        displayName: pgCore.text('display_name'),
        level: pgCore.integer('level').notNull().default(1),
      });
      const pdb = new GameDatabase({ ...opts(), schemas: { users } });
      await pdb.boot();
      try {
        assert.equal(pdb.dialect, 'pg');
        const created = await pdb.auth.settings.onRegisterAnonymously!({}) as any;
        await pdb.drizzle.update(pdb.tables.users).set({ displayName: 'Alice' }).where(eq(pdb.tables.users.id, created.id));
        const found: any = await pdb.auth.settings.onFindUserByEmail!('nobody@example.com');
        assert.equal(found, null);
        const [row] = await pdb.drizzle.select().from(pdb.tables.users).where(eq(pdb.tables.users.id, created.id));
        assert.equal(row.displayName, 'Alice');
        assert.equal(row.level, 1);
      } finally { await dropAllPg(pdb); await pdb.shutdown(); }
    });

    it(`[${label}] constraints and indexes via the factory third argument`, async () => {
      const users = tables.pg.users('colyseus_users', {
        handle: pgCore.text('handle'),
        handleLower: pgCore.text('handle_lower'),
      }, (t) => [
        pgCore.uniqueIndex('users_handle_lower_idx').on(t.handleLower),
        pgCore.check('users_handle_lower_chk', sql`${t.handleLower} = lower(${t.handle})`),
      ]);
      const pdb = new GameDatabase({ ...opts(), schemas: { users } });
      await pdb.boot();
      try {
        const a = await pdb.auth.settings.onRegisterAnonymously!({}) as any;
        const b = await pdb.auth.settings.onRegisterAnonymously!({}) as any;
        const setHandle = (userId: string, handle: string) => pdb.drizzle.update(pdb.tables.users)
          .set({ handle, handleLower: handle.toLowerCase() })
          .where(eq(pdb.tables.users.id, userId));
        await setHandle(a.id, 'JohnSmith');
        await rejectsWith(setHandle(b.id, 'johnsmith'), /unique|duplicate/i);
        await rejectsWith(
          pdb.drizzle.update(pdb.tables.users).set({ handle: 'Foo', handleLower: 'bar' }).where(eq(pdb.tables.users.id, b.id)),
          /check/i,
        );
        await setHandle(b.id, 'JaneDoe');
      } finally { await dropAllPg(pdb); await pdb.shutdown(); }
    });

    it(`[${label}] hand-rolled pgTable + columns.pg.users`, async () => {
      const users = pgCore.pgTable('colyseus_users', {
        ...columns.pg.users,
        handle: pgCore.text('handle'),
        handleLower: pgCore.text('handle_lower'),
      }, (t) => [
        pgCore.uniqueIndex('users_handle_lower_idx').on(t.handleLower),
        pgCore.check('users_handle_lower_chk', sql`${t.handleLower} = lower(${t.handle})`),
      ]);
      const pdb = new GameDatabase({ ...opts(), schemas: { users } });
      await pdb.boot();
      try {
        await pdb.drizzle.insert(users).values({ id: 'u1', handle: 'Ann', handleLower: 'ann' });
        await rejectsWith(pdb.drizzle.insert(users).values({ id: 'u2', handle: 'ANN', handleLower: 'ann' }), /unique|duplicate/i);
        assert.equal(await pdb.auth.settings.onFindUserByEmail!('nobody@example.com'), null);
      } finally { await dropAllPg(pdb); await pdb.shutdown(); }
    });

    it(`[${label}] drizzle-kit: pg-defaults barrel + dialect "postgresql" + migrations: { files }`, async () => {
      const { execFileSync } = await import('node:child_process');
      const dir = tmpFile(`dk-pg-${label}`);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'schema.ts'), `
import { tables } from "@colyseus/database";
import { text, uniqueIndex, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const users = tables.pg.users("colyseus_users", {
    handle: text("handle"),
    handleLower: text("handle_lower"),
}, (t) => [
    uniqueIndex("users_handle_lower_idx").on(t.handleLower),
    check("users_handle_lower_chk", sql\`\${t.handleLower} = lower(\${t.handle})\`),
]);

export {
    configs, cloudSaves, leaderboards, leaderboardEntries,
    analyticsEvents, roles, userNotes, adminAudit,
} from "@colyseus/database/pg-defaults";
`);
      fs.writeFileSync(path.join(dir, 'drizzle.config.ts'), `
import { defineConfig } from "drizzle-kit";

export default defineConfig({
    dialect: "postgresql",
    schema: "./schema.ts",
    out: "./drizzle",
    dbCredentials: { url: process.env.DATABASE_URL! },
});
`);
      fs.symlinkSync(path.join(cwdBefore, 'node_modules'), path.join(dir, 'node_modules'));
      const drizzleKit = path.join(fs.realpathSync(path.join(cwdBefore, 'node_modules', '@colyseus', 'database')), 'node_modules', '.bin', 'drizzle-kit');
      execFileSync(drizzleKit, ['generate', '--config', 'drizzle.config.ts'], { cwd: dir, stdio: 'pipe', env: { ...process.env, DATABASE_URL: 'postgres://unused' } });
      const sqlFile = fs.readdirSync(path.join(dir, 'drizzle')).filter((d) => !d.startsWith('.')).map((d) => path.join(dir, 'drizzle', d, 'migration.sql'))[0];
      const ddl = fs.readFileSync(sqlFile, 'utf8');
      assert.match(ddl, /CREATE UNIQUE INDEX "users_handle_lower_idx"/);
      assert.match(ddl, /CHECK \("handle_lower" = lower\("handle"\)\)/);

      const schemaMod = await import(path.join(dir, 'schema.ts'));
      const mdb = new GameDatabase({ ...opts(), schemas: schemaMod, migrations: { files: path.join(dir, 'drizzle') } });
      await mdb.boot();
      try {
        await mdb.drizzle.insert(mdb.tables.users).values({ id: 'u1', handle: 'Ann', handleLower: 'ann' } as any);
        await rejectsWith(mdb.drizzle.insert(mdb.tables.users).values({ id: 'u2', handle: 'ANN', handleLower: 'ann' } as any), /unique|duplicate/i);
        await mdb.saves.save('u1', { ok: 1 }); // the re-exported defaults were created too
      } finally { await dropAllPg(mdb); await mdb.shutdown(); }
    });
  }
});

import assert from 'node:assert';
import fs from 'node:fs';
import { describe, it, beforeEach, afterEach } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { sql } from 'drizzle-orm';
import { GameDatabase } from '../src/index.ts';
import { rawClientOf } from '../src/drivers.ts';
import { freshPgliteDir } from './backends.ts';

/**
 * PGlite takes no lock on its data dir, and two instances open on one dir
 * corrupt it: rows written by one are lost, or duplicated under a single
 * primary key. colyseus/vite boots a reloaded module's database before it
 * shuts down the one it replaces, so every reload overlapped two of them.
 */
describe('GameDatabase on a PGlite data dir another instance has open', () => {
  let dataDir: string;
  let opened: GameDatabase[];

  beforeEach(() => {
    dataDir = freshPgliteDir('shared');
    opened = [];
  });

  // here, not in the test: a failed assertion would leave clients open and hang the run
  afterEach(async () => {
    await Promise.all(opened.map((db) => db.shutdown()));
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const newDb = (connectionString = `pglite://${dataDir}`) => {
    const db = new GameDatabase({ connectionString });
    opened.push(db);
    return db;
  };
  const run = (db: GameDatabase, query: ReturnType<typeof sql>) => (db.drizzle as any).execute(query);
  const clientOf = (db: GameDatabase) => rawClientOf(db.drizzle);

  it('survives a reload: boot the replacement, then shut down the old one', async () => {
    const previous = newDb();
    await previous.boot();
    await run(previous, sql`create table t (id int primary key, v int not null)`);
    await run(previous, sql`insert into t select g, 0 from generate_series(1, 200) g`);

    const next = newDb();
    await next.boot();
    const client = clientOf(next);
    assert.strictEqual(clientOf(previous), client);

    await run(next, sql`update t set v = v + 1 where id % 2 = 0`);
    // rooms still running on the old module write through it until hotReload() finishes
    await run(previous, sql`update t set v = v + 10 where id % 3 = 0`);
    await previous.shutdown();
    assert.strictEqual(client.closed, false);

    await run(next, sql`insert into t select g, 0 from generate_series(201, 400) g`);
    await next.shutdown();
    assert.strictEqual(client.closed, true);

    const reopened = new PGlite(dataDir);
    try {
      const { rows } = await reopened.query<{ n: number; ids: number; total: number }>(
        'select count(*)::int as n, count(distinct id)::int as ids, sum(v)::int as total from t',
      );
      // 100 even ids + 10 × 66 multiples of 3
      assert.deepStrictEqual(rows[0], { n: 400, ids: 400, total: 760 });
    } finally {
      await reopened.close();
    }
  });

  it('keeps in-memory databases apart', async () => {
    const a = newDb('pglite://:memory:');
    const b = newDb('pglite://:memory:');
    await Promise.all([a.boot(), b.boot()]);
    assert.notStrictEqual(clientOf(a), clientOf(b));
  });
});

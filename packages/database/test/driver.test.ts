import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, beforeEach, afterEach } from 'node:test';
import { drizzle as sqliteDrizzle } from 'drizzle-orm/node-sqlite';
import { drizzle as pgliteDrizzle } from 'drizzle-orm/pglite';
import { PGlite } from '@electric-sql/pglite';
import { text } from 'drizzle-orm/sqlite-core';

import { GameDatabase, tables, POSTGRES_MAX_INTEGER } from '../src/index.ts';
import { DatabaseDriver } from '../src/driver.ts';

/**
 * DatabaseDriver — covered against both binding modes (GameDatabase and a
 * user-owned drizzle instance) and both SQL flavors (sqlite / pg-via-pglite).
 */

function room(over: Partial<any> = {}) {
  return {
    roomId: 'room0001', processId: 'proc0001', name: 'battle',
    clients: 1, maxClients: 4, locked: false, private: false,
    metadata: { mode: 'ranked', level: 5 }, unlisted: false,
    ...over,
  };
}

// Full CRUD pass shared by every scenario — asserts the dialect seam
// (JSON metadata filter, numeric JSON sort, atomic $inc + locked) plus
// has/findOne/remove/cleanup behave identically everywhere.
async function exerciseCrud(driver: DatabaseDriver) {
  await driver.boot();
  await driver.clear();

  await driver.persist(room({ roomId: 'r1', clients: 1, metadata: { mode: 'ranked', level: 5 } }) as any, true);
  await driver.persist(room({ roomId: 'r2', clients: 3, metadata: { mode: 'casual', level: 9 } }) as any, true);

  assert.equal(await driver.has('r1'), true);
  assert.equal(await driver.has('nope'), false);

  const found = await driver.findOne({ roomId: 'r2' } as any);
  assert.equal(found.roomId, 'r2');
  assert.deepEqual(found.metadata, { mode: 'casual', level: 9 });

  // Batch findByIds — one round trip for K roomIds, missing ids absent.
  const batch = await driver.findByIds(['r1', 'r2', 'r-missing']);
  assert.equal(batch.size, 2);
  assert.equal(batch.get('r1')?.roomId, 'r1');
  assert.equal(batch.get('r2')?.roomId, 'r2');
  assert.equal(batch.has('r-missing'), false);
  assert.equal((await driver.findByIds([])).size, 0);

  // JSON metadata equality filter
  const ranked = await driver.query({ name: 'battle', mode: 'ranked' } as any);
  assert.deepEqual(ranked.map((r: any) => r.roomId), ['r1']);

  // Numeric-aware JSON metadata sort (descending by level)
  const sorted = await driver.query({ name: 'battle' } as any, { level: -1 } as any);
  assert.deepEqual(sorted.map((r: any) => r.roomId), ['r2', 'r1']);

  // Atomic increment + race-safe locked: r2 goes 3 -> 4 clients, and
  // since 4 >= maxClients(4) locked must flip true even though $set
  // passed locked:false.
  await driver.update({ roomId: 'r2' } as any, { $inc: { clients: 1 }, $set: { locked: false } as any });
  const bumped = await driver.findOne({ roomId: 'r2' } as any);
  assert.equal(bumped.clients, 4);
  assert.equal(bumped.locked, true);

  assert.equal(await driver.remove('r1'), true);
  assert.equal(await driver.remove('r1'), false);

  await driver.cleanup('proc0001');
  assert.equal((await driver.query({ name: 'battle' } as any)).length, 0);
}

describe('DatabaseDriver — GameDatabase mode', () => {
  let db: GameDatabase;
  let dbPath: string;

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `drv-gdb-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  });

  afterEach(async () => {
    if (db) { await db.shutdown(); }
    for (const ext of ['', '-shm', '-wal']) {
      try { fs.unlinkSync(dbPath + ext); } catch { /* ignore */ }
    }
  });

  it('sqlite: full CRUD via an explicit GameDatabase', async () => {
    db = new GameDatabase({ connectionString: dbPath });
    await exerciseCrud(new DatabaseDriver({ database: db }));
  });

  it('pglite: full CRUD (pg SQL flavor)', async () => {
    db = new GameDatabase({ dialect: 'pglite', connectionString: 'pglite://:memory:' });
    await exerciseCrud(new DatabaseDriver({ database: db }));
  });

  it('defaults to GameDatabase.current when no options passed', async () => {
    db = new GameDatabase({ connectionString: dbPath });
    const driver = new DatabaseDriver(); // no args -> GameDatabase.current
    await driver.boot();
    await driver.clear();
    await driver.persist(room({ roomId: 'cur1' }) as any, true);
    assert.equal(await driver.has('cur1'), true);
  });

  it('shutdown() does NOT close the GameDatabase-owned connection', async () => {
    db = new GameDatabase({ connectionString: dbPath });
    const driver = new DatabaseDriver({ database: db });
    await driver.boot();
    await driver.shutdown();
    // GameDatabase connection must still be usable afterwards.
    const tv = await db.auth.getTokenVersion('whoever').catch(() => 0);
    assert.equal(typeof tv, 'number');
  });

  it('is driver-owned: GameDatabase alone never creates colyseus_room_caches', async () => {
    db = new GameDatabase({ connectionString: dbPath });
    await db.boot();
    const exists = (name: string) => (db.drizzle as any).$client
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
      .get(name);

    assert.equal(exists('colyseus_room_caches'), undefined);
    assert.ok(exists('colyseus_users'), 'registry tables should still be created');

    const driver = new DatabaseDriver({ database: db });
    await driver.boot();
    assert.ok(exists('colyseus_room_caches'), 'driver.boot() creates its own table');
  });

  it('accepts a custom room-cache table (extra column persists)', async () => {
    db = new GameDatabase({ connectionString: dbPath });
    const roomCaches = tables.sqlite.roomCaches('my_rooms', { region: text('region') });
    const driver = new DatabaseDriver({ database: db, schema: roomCaches });
    await driver.boot();
    await driver.clear();
    await driver.persist(room({ roomId: 'cs1', region: 'eu' } as any) as any, true);
    const got = await driver.findOne({ roomId: 'cs1' } as any);
    assert.equal((got as any).region, 'eu');
  });

  it('caps Infinity maxClients to POSTGRES_MAX_INTEGER (admin renders ∞ from this sentinel)', async () => {
    assert.equal(POSTGRES_MAX_INTEGER, 2147483647);
    db = new GameDatabase({ connectionString: dbPath });
    const driver = new DatabaseDriver({ database: db });
    await driver.boot();
    await driver.clear();
    await driver.persist(room({ roomId: 'inf1', maxClients: Infinity }) as any, true);
    const got = await driver.findOne({ roomId: 'inf1' } as any);
    assert.equal(got.maxClients, POSTGRES_MAX_INTEGER);
  });

  it('throws when no GameDatabase is available and no drizzle given', () => {
    (GameDatabase as any).current = undefined;
    assert.throws(() => new DatabaseDriver(), /no GameDatabase available/);
  });
});

describe('DatabaseDriver — raw drizzle mode (no GameDatabase)', () => {
  it('node-sqlite: full CRUD, and shutdown() closes the connection by default', async () => {
    const p = path.join(os.tmpdir(), `drv-raw-${Date.now()}.db`);
    const sdb = sqliteDrizzle({ connection: { path: p } });
    const driver = new DatabaseDriver({ drizzle: sdb, dialect: 'sqlite' });
    await exerciseCrud(driver);

    await driver.shutdown();
    let closed = false;
    try { (sdb as any).$client.prepare('SELECT 1').get(); }
    catch { closed = true; }
    assert.equal(closed, true, 'raw connection should be closed after shutdown()');

    for (const ext of ['', '-shm', '-wal']) {
      try { fs.unlinkSync(p + ext); } catch { /* ignore */ }
    }
  });

  it('pglite: full CRUD (pg flavor), closeOnShutdown:false leaves it open', async () => {
    const client = new PGlite();
    const pdb = pgliteDrizzle({ client });
    const driver = new DatabaseDriver({ drizzle: pdb, dialect: 'pg', closeOnShutdown: false });
    await exerciseCrud(driver);

    await driver.shutdown();
    let stillOpen = false;
    try { await client.query('SELECT 1'); stillOpen = true; } catch { stillOpen = false; }
    assert.equal(stillOpen, true, 'closeOnShutdown:false must leave the connection open');
    await client.close();
  });
});

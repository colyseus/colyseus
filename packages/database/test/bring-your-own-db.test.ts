/**
 * `GameDatabaseOptions.db` — adopt a drizzle instance the caller built.
 *
 * The instance can wrap any driver, so the raw client behind it is identified
 * by capability (drivers.ts: probeRawClient) rather than assumed from the
 * dialect. Two things follow, and both are covered here:
 *
 *   - `migrations: "auto"` issues raw DDL, so it needs that client. Reading it
 *     off the instance is what makes the default strategy work at all; when
 *     there's nothing to read, the error names the strategies that don't need it.
 *   - The client stays the caller's. `shutdown()` closes only a connection we
 *     opened ourselves.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import { describe, it, afterEach } from 'node:test';
import { drizzle } from 'drizzle-orm/node-sqlite';
import { GameDatabase } from '../src/index.ts';
import { probeRawClient, importDriver } from '../src/drivers.ts';
import { freshSqlitePath, listTables } from './backends.ts';

const cleanups: Array<() => void> = [];

/** A drizzle instance the way a consumer would build one. */
function userDrizzle() {
  const dbPath = freshSqlitePath('byo');
  cleanups.push(() => {
    for (const ext of ['', '-shm', '-wal']) {
      try { fs.unlinkSync(dbPath + ext); } catch { /* ignore */ }
    }
  });
  return drizzle({ connection: { path: dbPath } });
}

describe('GameDatabaseOptions.db (bring your own drizzle instance)', () => {
  afterEach(() => {
    while (cleanups.length) { cleanups.pop()!(); }
  });

  it('boots under the default "auto" strategy and creates the built-in tables', async () => {
    const db = new GameDatabase({ db: userDrizzle() });
    await db.boot();

    const tables = await listTables(db);
    assert.ok(tables.includes('colyseus_users'), `expected colyseus_users, got ${tables.join(', ')}`);
    assert.ok(tables.includes('colyseus_cloud_saves'), `expected colyseus_cloud_saves, got ${tables.join(', ')}`);
  });

  it('serves the services off the adopted instance', async () => {
    const db = new GameDatabase({ db: userDrizzle() });
    await db.boot();

    const user: any = await db.auth.settings.onRegisterAnonymously!({} as any);
    await db.saves.save(user.id, { level: 7 });
    const loaded = await db.saves.load(user.id);
    assert.deepEqual(loaded?.data, { level: 7 });
  });

  it('leaves the caller-owned client open on shutdown', async () => {
    const instance = userDrizzle();
    const db = new GameDatabase({ db: instance });
    await db.boot();
    await db.shutdown();

    // Still usable: we never opened this connection, so we don't close it.
    const rows = (instance as any).$client.prepare('SELECT 1 AS ok').all();
    assert.deepEqual(rows, [{ ok: 1 }]);
  });

  it('reads the SQL flavor off the instance when `dialect` is omitted', () => {
    assert.equal(new GameDatabase({ db: userDrizzle() }).dialect, 'sqlite');
    // A pg instance with no `dialect` used to fall back to sqlite, then emit
    // sqlite DDL against Postgres.
    const pgish = new GameDatabase({ db: { $client: { query() {}, connect() {}, end() {} } } as any });
    assert.equal(pgish.dialect, 'pg');
  });

  it('routes DDL through .query() for a node-postgres client', async () => {
    // node-postgres exposes neither `.unsafe()` (postgres-js) nor `.exec()`
    // (pglite / sqlite), so `auto` reaches it via `.query()`. Recorded rather
    // than run against a server — the assertion is the routing.
    const statements: string[] = [];
    const client = {
      connect() {},
      end() {},
      query(text: string) {
        statements.push(text);
        // fetchExistingColumns reads `.rows`; empty means "table is new".
        return Promise.resolve({ rows: [] });
      },
    };
    const db = new GameDatabase({ dialect: 'pg', db: { $client: client } as any });
    await db.boot();

    const created = statements.filter((s) => s.startsWith('CREATE TABLE'));
    assert.ok(
      created.some((s) => s.includes('colyseus_users')),
      `expected a CREATE TABLE for colyseus_users, got ${created.length} CREATE statements`,
    );
    // pg placeholders, not sqlite's `?` — the introspection query is dialect-correct.
    assert.ok(statements.some((s) => s.includes('information_schema.columns') && s.includes('$1')));
  });

  it('explains itself when "auto" has no client to reach', async () => {
    // A drizzle-shaped object exposing no $client — e.g. an HTTP-proxy driver.
    const db = new GameDatabase({ db: { query: {} } as any });
    await assert.rejects(() => db.boot(), (error: Error) => {
      assert.match(error.message, /migrations: "auto" needs raw SQL access/);
      assert.match(error.message, /migrations: "skip"/);
      return true;
    });
  });

  it('accepts a clientless instance under "skip"', async () => {
    const db = new GameDatabase({ db: { query: {} } as any, migrations: 'skip' });
    await db.boot();
  });
});

describe('probeRawClient', () => {
  it('identifies each driver by the methods it exposes', () => {
    assert.equal(probeRawClient(Object.assign(() => {}, { unsafe() {}, end() {} })), 'postgres-js');
    assert.equal(probeRawClient({ exec() {}, query() {}, waitReady: Promise.resolve() }), 'pglite');
    assert.equal(probeRawClient({ query() {}, connect() {}, end() {} }), 'node-postgres');
    // The real thing, not a stand-in: drizzle could rename what `$client` exposes.
    assert.equal(probeRawClient((userDrizzle() as any).$client), 'sqlite');
  });

  it('returns null when there is no usable client', () => {
    assert.equal(probeRawClient(null), null);
    assert.equal(probeRawClient(undefined), null);
    assert.equal(probeRawClient({}), null);
  });
});

describe('importDriver', () => {
  it('turns a missing package into an install hint', async () => {
    await assert.rejects(
      () => importDriver(
        'not-a-real-driver-pkg',
        () => import('not-a-real-driver-pkg' as string),
        'this dialect needs a driver',
      ),
      (error: Error) => {
        assert.match(error.message, /this dialect needs a driver/);
        assert.match(error.message, /npm install --save not-a-real-driver-pkg/);
        return true;
      },
    );
  });

  it('offers the alternative route when there is one', async () => {
    await assert.rejects(
      () => importDriver('nope-pkg', () => import('nope-pkg' as string), 'needs a driver', 'or pass `db` instead'),
      (error: Error) => {
        assert.match(error.message, /npm install --save nope-pkg/);
        assert.match(error.message, /or pass `db` instead/);
        return true;
      },
    );
  });

  it('passes a missing transitive dependency through untouched', async () => {
    // The driver itself is installed; something it imports is not. Reporting
    // "install postgres" there would send the reader down the wrong path.
    const inner: any = new Error("Cannot find package 'some-inner-dep' imported from /x/postgres/index.js");
    inner.code = 'ERR_MODULE_NOT_FOUND';
    await assert.rejects(
      () => importDriver('postgres', () => Promise.reject(inner), 'needs postgres'),
      (error: Error) => {
        assert.equal(error, inner);
        return true;
      },
    );
  });

  it('passes a non-resolution failure through untouched', async () => {
    const boom = new Error('driver blew up at import time');
    await assert.rejects(
      () => importDriver('postgres', () => Promise.reject(boom), 'needs postgres'),
      (error: Error) => {
        assert.equal(error, boom);
        return true;
      },
    );
  });
});

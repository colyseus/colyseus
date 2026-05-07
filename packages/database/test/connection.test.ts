import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, beforeEach, afterEach } from 'node:test';
import { GameDatabase } from '../src/index.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Cover the connection + pragmas tuning knobs on GameDatabaseOptions.
 *
 * - sqlite: PRAGMAs defaults applied (WAL + FK), can be overridden, can be
 *   suppressed entirely; DatabaseSyncOptions like readOnly are forwarded.
 * - pglite: PGliteOptions like relaxedDurability are forwarded.
 *
 * (postgres-js options pass through the same mechanism but require a real
 * PG to verify; covered structurally by the tests below.)
 */

let dbPath: string;
let db: GameDatabase;

function freshSqlitePath(): string {
  return path.join(__dirname, `.conn-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

async function cleanup() {
  if (db) { await db.shutdown(); }
  for (const ext of ['', '-shm', '-wal']) {
    try { fs.unlinkSync(dbPath + ext); } catch { /* ignore */ }
  }
}

function readPragma(database: GameDatabase, name: string): string | number {
  const conn = (database as any).ownedConnection;
  const row = conn.prepare(`PRAGMA ${name}`).get() as Record<string, any>;
  return row ? Object.values(row)[0] : '';
}

describe('GameDatabaseOptions.pragmas (sqlite)', () => {
  beforeEach(() => { dbPath = freshSqlitePath(); });
  afterEach(cleanup);

  it('applies WAL + foreign_keys defaults out of the box', async () => {
    db = new GameDatabase({ connectionString: dbPath });
    await db.boot();
    assert.equal(String(readPragma(db, 'journal_mode')).toLowerCase(), 'wal');
    assert.equal(Number(readPragma(db, 'foreign_keys')), 1);
  });

  it('merges user pragmas over defaults — keeps WAL, adds synchronous=NORMAL', async () => {
    db = new GameDatabase({
      connectionString: dbPath,
      pragmas: { synchronous: 'NORMAL', cache_size: -64000 },
    });
    await db.boot();
    assert.equal(String(readPragma(db, 'journal_mode')).toLowerCase(), 'wal');
    // synchronous values: 0=OFF, 1=NORMAL, 2=FULL, 3=EXTRA
    assert.equal(Number(readPragma(db, 'synchronous')), 1);
    assert.equal(Number(readPragma(db, 'cache_size')), -64000);
  });

  it('user can override the default journal_mode', async () => {
    db = new GameDatabase({
      connectionString: dbPath,
      pragmas: { journal_mode: 'DELETE' },
    });
    await db.boot();
    assert.equal(String(readPragma(db, 'journal_mode')).toLowerCase(), 'delete');
  });

  it('pragmas: false skips OUR PRAGMA loop — journal_mode reverts to default', async () => {
    // Note: Node's DatabaseSync also has its own `enableForeignKeyConstraints`
    // option which defaults to true, so FK stays on unless the user also
    // sets `connection: { enableForeignKeyConstraints: false }`. `pragmas:
    // false` only short-circuits the GameDatabase-level PRAGMA exec.
    db = new GameDatabase({
      connectionString: dbPath,
      pragmas: false,
    });
    await db.boot();
    assert.notEqual(String(readPragma(db, 'journal_mode')).toLowerCase(), 'wal');
  });

  it('pragmas: false + connection.enableForeignKeyConstraints: false → FK fully off', async () => {
    db = new GameDatabase({
      connectionString: dbPath,
      pragmas: false,
      connection: { enableForeignKeyConstraints: false },
    });
    await db.boot();
    assert.equal(Number(readPragma(db, 'foreign_keys')), 0);
  });
});

describe('GameDatabaseOptions.connection (sqlite)', () => {
  beforeEach(() => { dbPath = freshSqlitePath(); });
  afterEach(cleanup);

  it('forwards readOnly through to DatabaseSync — writes throw', async () => {
    // First: create the file with the schema by booting normally.
    db = new GameDatabase({ connectionString: dbPath });
    await db.boot();
    await db.config.set('seed', 1);
    await db.shutdown();

    // Reopen read-only via the new connection passthrough.
    db = new GameDatabase({
      connectionString: dbPath,
      connection: { readOnly: true },
      // Auto-migrate would fail on a read-only DB; use 'skip' since the
      // schema is already in place.
      migrations: 'skip',
    });
    await db.boot();
    assert.equal(await db.config.get('seed'), 1);
    await assert.rejects(
      db.config.set('seed', 2),
      /readonly|read.only/i,
    );
  });
});

describe('GameDatabaseOptions.connection (pglite)', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pgl-conn-'));
  });

  afterEach(async () => {
    if (db) { await db.shutdown(); }
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('forwards relaxedDurability through to PGlite', async () => {
    db = new GameDatabase({
      dialect: 'pglite',
      connectionString: `pglite://${dataDir}`,
      connection: { relaxedDurability: true },
    });
    await db.boot();
    // No public read-back of relaxedDurability — assertion is "boots cleanly
    // with the option set". A flag-rejection regression here would throw at
    // boot.
    assert.ok(db.drizzle);
  });
});

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, beforeEach, afterEach } from 'node:test';
import { GameDatabase } from '../src/index.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('GameDatabase.boot() idempotency', () => {
  let dbPath: string;
  let db: GameDatabase;

  beforeEach(() => {
    dbPath = path.join(__dirname, `.boot-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  });

  afterEach(async () => {
    if (db) { await db.shutdown(); }
    for (const ext of ['', '-shm', '-wal']) {
      try { fs.unlinkSync(dbPath + ext); } catch { /* ignore */ }
    }
  });

  it('returns the same promise on repeat calls', () => {
    db = new GameDatabase({ connectionString: dbPath });
    const p1 = db.boot();
    const p2 = db.boot();
    assert.strictEqual(p1, p2);
  });

  it('resolves once when awaited concurrently', async () => {
    db = new GameDatabase({ connectionString: dbPath });
    const results = await Promise.all([db.boot(), db.boot(), db.boot()]);
    assert.deepStrictEqual(results, [undefined, undefined, undefined]);
  });

  it('eager boot + late await share one promise', async () => {
    db = new GameDatabase({ connectionString: dbPath });
    const eager = db.boot();
    const late = db.boot();
    assert.strictEqual(eager, late);
    await late;
    assert.strictEqual(db.boot(), eager);
  });

  it('populates `tables` synchronously in the constructor', () => {
    db = new GameDatabase({ connectionString: dbPath });
    assert.ok(db.tables);
    assert.ok(db.tables.users);
    assert.ok(db.tables.leaderboards);
    assert.ok(db.tables.cloudSaves);
  });

  it('publishes itself as `GameDatabase.current` (last-construction wins)', () => {
    db = new GameDatabase({ connectionString: dbPath });
    assert.strictEqual(GameDatabase.current, db);

    const dbPath2 = path.join(__dirname, `.boot-${Date.now()}-second.db`);
    const db2 = new GameDatabase({ connectionString: dbPath2 });
    assert.strictEqual(GameDatabase.current, db2);
    for (const ext of ['', '-shm', '-wal']) {
      try { fs.unlinkSync(dbPath2 + ext); } catch { /* ignore */ }
    }
  });
});

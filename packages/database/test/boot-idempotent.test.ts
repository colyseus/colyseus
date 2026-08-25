import assert from 'node:assert';
import { describe, it, beforeEach, afterEach } from 'node:test';
import { GameDatabase } from '../src/index.ts';
import { BACKENDS } from './backends.ts';

for (const backend of BACKENDS) {
  describe(`GameDatabase.boot() idempotency (${backend.name})`, () => {
    let db: GameDatabase;

    beforeEach(() => {
      db = backend.newDb();
    });

    afterEach(async () => {
      if (db) { await backend.cleanupOne(db); }
    });

    it('returns the same promise on repeat calls', () => {
      const p1 = db.boot();
      const p2 = db.boot();
      assert.strictEqual(p1, p2);
    });

    it('resolves once when awaited concurrently', async () => {
      const results = await Promise.all([db.boot(), db.boot(), db.boot()]);
      assert.deepStrictEqual(results, [undefined, undefined, undefined]);
    });

    it('eager boot + late await share one promise', async () => {
      const eager = db.boot();
      const late = db.boot();
      assert.strictEqual(eager, late);
      await late;
      assert.strictEqual(db.boot(), eager);
    });

    it('populates `tables` synchronously in the constructor', () => {
      assert.ok(db.tables);
      assert.ok(db.tables.users);
      assert.ok(db.tables.leaderboards);
      assert.ok(db.tables.cloudSaves);
    });

    it('publishes itself as `GameDatabase.current` (last-construction wins)', async () => {
      assert.strictEqual(GameDatabase.current, db);

      const db2 = backend.newDb();
      assert.strictEqual(GameDatabase.current, db2);
      await backend.cleanupOne(db2);
    });
  });
}

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, beforeEach, afterEach } from 'node:test';
import { GameDatabase } from '../src/index.ts';
import { BACKENDS, listTables, rawQuery, tableExists } from './backends.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

for (const backend of BACKENDS) {
  describe(`GameDatabase: migration strategies (${backend.name})`, () => {
    let db: GameDatabase;

    async function cleanup() {
      if (db) { await backend.cleanupOne(db); }
    }

    describe("default ('auto')", () => {
      beforeEach(async () => {
        db = backend.newDb();
        await db.boot();
      });
      afterEach(cleanup);

      it('creates every built-in table', async () => {
        const names = await listTables(db);
        assert.ok(names.includes('colyseus_users'));
        assert.ok(names.includes('colyseus_configs'));
        assert.ok(names.includes('colyseus_leaderboards'));
        assert.ok(names.includes('colyseus_roles'));
      });
    });

    describe("'skip'", () => {
      beforeEach(async () => {
        db = backend.newDb({ migrations: 'skip' });
        await db.boot();
      });
      afterEach(cleanup);

      it('does not create any colyseus_ tables', async () => {
        const names = await listTables(db);
        assert.equal(names.length, 0, 'skip strategy should not auto-create tables');
      });
    });

    describe("{ files: ... }", () => {
      afterEach(cleanup);

      it('applies a real drizzle-kit-generated migration', async () => {
        // drizzle-orm 1.0+ folder format: <folder>/<YYYYMMDDHHMMSS_name>/migration.sql.
        // No _journal.json — that was the old format. Each migration directory's
        // 14-char prefix is parsed by formatToMillis() in migrator.utils.
        const folder = path.join(__dirname, `.fm-${backend.name}-${Date.now()}`);
        const migDir = path.join(folder, '20260101000000_test_initial');
        fs.mkdirSync(migDir, { recursive: true });
        fs.writeFileSync(
          path.join(migDir, 'migration.sql'),
          `CREATE TABLE "test_evolving" (\n` +
          `  "id" text PRIMARY KEY,\n` +
          `  "name" text NOT NULL\n` +
          `);\n` +
          `--> statement-breakpoint\n` +
          `INSERT INTO "test_evolving" ("id", "name") VALUES ('a', 'first');\n`,
        );

        try {
          db = backend.newDb({ migrations: { files: folder } });
          await db.boot();

          const rows = await rawQuery(db, 'SELECT id, name FROM test_evolving') as Array<{ id: string; name: string }>;
          assert.equal(rows.length, 1);
          assert.equal(rows[0]!.id, 'a');
          assert.equal(rows[0]!.name, 'first');

          // Auto-create path was bypassed: built-in colyseus_* tables don't exist.
          assert.equal(
            await tableExists(db, 'colyseus_users'),
            false,
            'files strategy should skip auto-create',
          );

          // Drizzle's tracking table exists and recorded the migration. The
          // physical table name differs by dialect: sqlite uses
          // `__drizzle_migrations`, postgres puts it in `drizzle.__drizzle_migrations`
          // (a separate schema). Probe each accordingly.
          if (db.dialect === 'pg') {
            const probe = await rawQuery(
              db,
              `SELECT table_name AS name FROM information_schema.tables
               WHERE table_schema = 'drizzle' AND table_name = '__drizzle_migrations'`,
            );
            assert.equal(probe.length, 1, 'drizzle journal table should exist');
          } else {
            assert.equal(
              await tableExists(db, '__drizzle_migrations'),
              true,
              'drizzle journal table should exist',
            );
          }
        } finally {
          fs.rmSync(folder, { recursive: true, force: true });
        }
      });

      it('is idempotent — re-running with the same folder is a no-op', async () => {
        const folder = path.join(__dirname, `.idempotent-${backend.name}-${Date.now()}`);
        const migDir = path.join(folder, '20260101000000_init');
        fs.mkdirSync(migDir, { recursive: true });
        fs.writeFileSync(
          path.join(migDir, 'migration.sql'),
          `CREATE TABLE "once" ("id" text PRIMARY KEY);\n` +
          `--> statement-breakpoint\n` +
          `INSERT INTO "once" ("id") VALUES ('only');\n`,
        );

        try {
          db = backend.newDb({ migrations: { files: folder } });
          await db.boot();

          // Capture cleanup target before the first shutdown drops it.
          const previousDb = db;
          await previousDb.shutdown();

          // Second boot with the same folder — should NOT re-run the INSERT
          // (which would fail with a UNIQUE-constraint violation).
          //
          // Reuse the same backing store (sqlite file / pglite data dir) so we
          // exercise idempotency against the same migration history.
          const cleanupPath = (previousDb as any).__cleanupPath as string;
          db = backend.name === 'sqlite'
            ? new GameDatabase({ connectionString: cleanupPath, migrations: { files: folder } })
            : new GameDatabase({ dialect: 'pglite', connectionString: `pglite://${cleanupPath}`, migrations: { files: folder } });
          (db as any).__cleanupPath = cleanupPath;
          await db.boot();

          const rows = await rawQuery(db, 'SELECT id FROM once') as Array<{ id: string }>;
          assert.equal(rows.length, 1, 'migration should apply exactly once');
        } finally {
          fs.rmSync(folder, { recursive: true, force: true });
        }
      });

      it('rejects an unknown strategy', async () => {
        db = backend.newDb({
          // @ts-expect-error — explicitly invalid
          migrations: { magic: 'no' },
        });
        await assert.rejects(db.boot(), /unknown migration strategy/);
      });
    });
  });
}

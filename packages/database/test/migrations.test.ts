import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, beforeEach, afterEach } from 'node:test';
import { GameDatabase } from '../src/index.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let dbPath: string;
let db: GameDatabase;

function freshDbPath(): string {
  return path.join(__dirname, `.mig-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

async function cleanup() {
  if (db) { await db.shutdown(); }
  for (const ext of ['', '-shm', '-wal']) {
    try { fs.unlinkSync(dbPath + ext); } catch { /* ignore */ }
  }
}

describe('GameDatabase: migration strategies', () => {
  describe("default ('auto')", () => {
    beforeEach(async () => {
      dbPath = freshDbPath();
      db = new GameDatabase({ connectionString: dbPath });
      await db.boot();
    });
    afterEach(cleanup);

    it('creates every built-in table', async () => {
      const conn = (db as any).ownedConnection;
      const tables = conn.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'colyseus_%'"
      ).all() as Array<{ name: string }>;
      const names = tables.map((t) => t.name).sort();
      assert.ok(names.includes('colyseus_users'));
      assert.ok(names.includes('colyseus_configs'));
      assert.ok(names.includes('colyseus_leaderboards'));
      assert.ok(names.includes('colyseus_user_roles'));
    });
  });

  describe("'skip'", () => {
    beforeEach(async () => {
      dbPath = freshDbPath();
      db = new GameDatabase({ connectionString: dbPath, migrations: 'skip' });
      await db.boot();
    });
    afterEach(cleanup);

    it('does not create any colyseus_ tables', async () => {
      const conn = (db as any).ownedConnection;
      const tables = conn.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'colyseus_%'"
      ).all() as Array<{ name: string }>;
      assert.equal(tables.length, 0, 'skip strategy should not auto-create tables');
    });
  });

  describe("{ files: ... }", () => {
    beforeEach(async () => {
      dbPath = freshDbPath();
    });
    afterEach(cleanup);

    it('applies a real drizzle-kit-generated migration', async () => {
      // drizzle-orm 1.0+ folder format: <folder>/<YYYYMMDDHHMMSS_name>/migration.sql.
      // No _journal.json — that was the old format. Each migration directory's
      // 14-char prefix is parsed by formatToMillis() in migrator.utils.
      const folder = path.join(__dirname, `.fm-${Date.now()}`);
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
        db = new GameDatabase({
          connectionString: dbPath,
          migrations: { files: folder },
        });
        await db.boot();

        const conn = (db as any).ownedConnection;
        const rows = conn.prepare("SELECT id, name FROM test_evolving").all() as Array<{ id: string; name: string }>;
        assert.equal(rows.length, 1);
        assert.equal(rows[0]!.id, 'a');
        assert.equal(rows[0]!.name, 'first');

        // Auto-create path was bypassed: built-in colyseus_* tables don't exist.
        const auto = conn.prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name = 'colyseus_users'"
        ).all();
        assert.equal(auto.length, 0, 'files strategy should skip auto-create');

        // Drizzle's tracking table exists and recorded the migration.
        const journal = conn.prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name = '__drizzle_migrations'"
        ).all();
        assert.equal(journal.length, 1);
      } finally {
        fs.rmSync(folder, { recursive: true, force: true });
      }
    });

    it('is idempotent — re-running with the same folder is a no-op', async () => {
      const folder = path.join(__dirname, `.idempotent-${Date.now()}`);
      const migDir = path.join(folder, '20260101000000_init');
      fs.mkdirSync(migDir, { recursive: true });
      fs.writeFileSync(
        path.join(migDir, 'migration.sql'),
        `CREATE TABLE "once" ("id" text PRIMARY KEY);\n` +
        `--> statement-breakpoint\n` +
        `INSERT INTO "once" ("id") VALUES ('only');\n`,
      );

      try {
        db = new GameDatabase({ connectionString: dbPath, migrations: { files: folder } });
        await db.boot();
        await db.shutdown();

        // Second boot with the same folder — should NOT re-run the INSERT
        // (which would fail with a UNIQUE-constraint violation).
        db = new GameDatabase({ connectionString: dbPath, migrations: { files: folder } });
        await db.boot();
        const conn = (db as any).ownedConnection;
        const rows = conn.prepare("SELECT id FROM once").all() as Array<{ id: string }>;
        assert.equal(rows.length, 1, 'migration should apply exactly once');
      } finally {
        fs.rmSync(folder, { recursive: true, force: true });
      }
    });

    it('rejects an unknown strategy', async () => {
      db = new GameDatabase({
        connectionString: dbPath,
        // @ts-expect-error — explicitly invalid
        migrations: { magic: 'no' },
      });
      await assert.rejects(db.boot(), /unknown migration strategy/);
    });
  });
});

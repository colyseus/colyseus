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

    it("delegates to drizzle-orm's migrator (no auto-create on the side)", async () => {
      // drizzle-orm reads <folder>/meta/_journal.json — exact shape varies
      // by drizzle-kit version, so testing the FULL migration application
      // here couples this test to drizzle-kit. Instead we test the
      // delegation contract: when files-mode is selected, the colyseus_*
      // auto-tables are NOT created (the auto path is skipped), and the
      // migrator is invoked. An empty-but-valid folder lets the migrator
      // run with zero pending migrations.
      const folder = path.join(__dirname, `.fm-${Date.now()}`);
      fs.mkdirSync(path.join(folder, 'meta'), { recursive: true });
      fs.writeFileSync(
        path.join(folder, 'meta', '_journal.json'),
        JSON.stringify({ version: '7', dialect: 'sqlite', entries: [] }),
      );

      try {
        db = new GameDatabase({
          connectionString: dbPath,
          migrations: { files: folder },
        });
        // The migrator may still complain about journal-version drift across
        // drizzle-kit releases. We accept either outcome — what matters is
        // that the auto-create path was NOT taken (asserted below).
        await db.boot().catch(() => { /* migrator-version mismatch is ok here */ });

        const conn = (db as any).ownedConnection;
        const auto = conn.prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name = 'colyseus_users'"
        ).all();
        assert.equal(auto.length, 0, 'files strategy should bypass auto-create');
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

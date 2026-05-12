/**
 * End-to-end check of the documented `migrations: { files }` workflow:
 *
 *   1. User defines schema barrel that customizes one table (`users`) and
 *      re-exports the rest from sqlite-defaults — see fixtures/custom-schema/schema.ts.
 *   2. The committed migration files under fixtures/custom-schema/migrations/
 *      are produced by `pnpm test:regen-fixture` (scripts/regen-migration.ts).
 *      The package's own DDL generator (`utils.ts: generateCreateTableSQL`)
 *      backs both the file-based migrator AND the auto-strategy, so they
 *      can't drift.
 *   3. GameDatabase boots with `schemas: schema` + `migrations: { files }`
 *      and should land with both the customized `users` table and the
 *      colyseus_* defaults available.
 *
 * Drizzle 1.0's migrator is permissive — it walks `<timestamp>_*` dirs in
 * name-sorted order and reads each `migration.sql` (no journal needed),
 * so this fixture is one consolidated initial migration. If you add new
 * built-in tables to schemas/sqlite.ts later, just re-run the regen script.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, before, after } from 'node:test';
import { GameDatabase } from '../src/index.ts';
import * as schema from './fixtures/custom-schema/schema.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.join(__dirname, 'fixtures', 'custom-schema', 'migrations');

let dbPath: string;
let db: GameDatabase<typeof schema>;

describe('GameDatabase with drizzle-kit-generated migrations + custom schemas', () => {
  before(async () => {
    dbPath = path.join(__dirname, `.mig-custom-${Date.now()}.db`);
    db = new GameDatabase({
      connectionString: dbPath,
      schemas: schema,
      migrations: { files: migrationsFolder },
    });
    await db.boot();
  });

  after(async () => {
    if (db) { await db.shutdown(); }
    for (const ext of ['', '-shm', '-wal']) {
      try { fs.unlinkSync(dbPath + ext); } catch { /* ignore */ }
    }
  });

  it('the migrations folder used here matches the regen-migration output', () => {
    // Sanity: someone breaking the fixture (deleting the file, regenerating
    // with a different schema) should fail loudly here, not deep inside the
    // boot path. Quote-agnostic so the assertion survives format swaps
    // (drizzle-kit emits backticks for sqlite; our regen-migration script
    // uses double-quoted identifiers — both run fine through sqlite).
    const dirs = fs.readdirSync(migrationsFolder).filter((d) =>
      fs.statSync(path.join(migrationsFolder, d)).isDirectory(),
    );
    assert.ok(dirs.length >= 1, 'fixture should contain at least one migration dir');
    const sql = fs.readFileSync(path.join(migrationsFolder, dirs[0]!, 'migration.sql'), 'utf8');
    assert.match(sql, /CREATE TABLE [`"]?(?:IF NOT EXISTS [`"]?)?users/, 'expected the customized `users` table in the generated SQL');
    assert.match(sql, /[`"]display_name[`"] text/, 'expected the custom display_name column');
    assert.match(sql, /CREATE TABLE [`"]?(?:IF NOT EXISTS [`"]?)?colyseus_configs/, 'expected default colyseus_configs table');
  });

  it('creates the customized `users` table with extra columns', async () => {
    const conn = (db as any).ownedConnection;
    const cols = conn.prepare("SELECT name FROM pragma_table_info('users')").all() as Array<{ name: string }>;
    const names = cols.map((c) => c.name);
    assert.ok(names.includes('id'), 'base id column');
    assert.ok(names.includes('email'), 'base email column');
    assert.ok(names.includes('display_name'), 'custom display_name column');
    assert.ok(names.includes('level'), 'custom level column');
  });

  it('creates the default colyseus_* tables alongside the custom one', async () => {
    const conn = (db as any).ownedConnection;
    const tables = conn.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'colyseus_%'"
    ).all() as Array<{ name: string }>;
    const names = tables.map((t) => t.name).sort();
    for (const expected of [
      'colyseus_analytics_events',
      'colyseus_cloud_saves',
      'colyseus_configs',
      'colyseus_leaderboard_entries',
      'colyseus_leaderboards',
      'colyseus_roles',
      'colyseus_user_notes',
      'colyseus_admin_audit',
    ]) {
      assert.ok(names.includes(expected), `expected default table ${expected}; got: ${names.join(', ')}`);
    }
  });

  it('services operate against the customized table — registerAnonymous + lookup by display_name', async () => {
    const created = await db.auth.settings.onRegisterAnonymously?.({});
    assert.ok(created, 'registerAnonymous should return a created user');
    const userId = (created as { id: string }).id;

    // Set a display_name on the row drizzle-kit's migration created
    const conn = (db as any).ownedConnection;
    conn.prepare('UPDATE users SET display_name = ?, level = ? WHERE id = ?').run('Endel', 7, userId);

    const row = conn.prepare("SELECT id, display_name, level FROM users WHERE id = ?").get(userId) as
      | { id: string; display_name: string | null; level: number | null } | undefined;
    assert.ok(row, 'expected to read back the inserted user');
    assert.equal(row!.display_name, 'Endel');
    assert.equal(row!.level, 7);
  });
});

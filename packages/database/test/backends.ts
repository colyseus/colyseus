/**
 * Shared sqlite + pglite test matrix.
 *
 * Mirrors the BACKENDS array originally defined inline in services.test.ts.
 * Each backend exposes a `newDb()` factory that returns an unbooted
 * GameDatabase wired to a fresh, isolated data store, and a `cleanupOne()`
 * that tears it down (shutdown + remove the file/dir).
 *
 * Use `applyBackends((backend) => describe(...))` to run a parameterized
 * describe block per backend, or import `BACKENDS` directly for finer
 * control.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GameDatabase, type GameDatabaseOptions } from '../src/index.ts';

export interface Backend {
  name: 'sqlite' | 'pglite';
  /** Build an unbooted GameDatabase with the backend's connection wired up. */
  newDb<S extends Record<string, any> = {}, C extends Record<string, any> = {}>(
    options?: Omit<GameDatabaseOptions<S, C>, 'connectionString' | 'dialect'>,
  ): GameDatabase<S, any, C>;
  cleanupOne(db: GameDatabase): Promise<void>;
}

function freshSqlitePath(label: string): string {
  return path.join(os.tmpdir(), `colyseus-db-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

function freshPgliteDir(label: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `colyseus-pglite-${label}-`));
}

export const BACKENDS: Backend[] = [
  {
    name: 'sqlite',
    newDb(options) {
      const dbPath = freshSqlitePath('t');
      const db = new GameDatabase({ ...(options as any), connectionString: dbPath });
      (db as any).__cleanupPath = dbPath;
      return db as any;
    },
    async cleanupOne(db) {
      await db.shutdown();
      const dbPath = (db as any).__cleanupPath as string | undefined;
      if (!dbPath) { return; }
      for (const ext of ['', '-shm', '-wal']) {
        try { fs.unlinkSync(dbPath + ext); } catch { /* ignore */ }
      }
    },
  },
  // pglite backend — disabled by default to keep the suite fast (~30s
  // overhead per matrixed file from PGlite/Wasm boot). The entry is kept
  // here so re-enabling is a one-liner; services.test.ts and driver.test.ts
  // still cover pg-flavor end-to-end.
  // {
  //   name: 'pglite',
  //   newDb(options) {
  //     const dataDir = freshPgliteDir('t');
  //     const db = new GameDatabase({
  //       ...(options as any),
  //       dialect: 'pglite',
  //       connectionString: `pglite://${dataDir}`,
  //     });
  //     (db as any).__cleanupPath = dataDir;
  //     return db as any;
  //   },
  //   async cleanupOne(db) {
  //     await db.shutdown();
  //     const dataDir = (db as any).__cleanupPath as string | undefined;
  //     if (!dataDir) { return; }
  //     try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* ignore */ }
  //   },
  // },
];

/** Run a describe-style block once per backend. */
export function applyBackends(register: (backend: Backend) => void): void {
  for (const backend of BACKENDS) { register(backend); }
}

// ---------------------------------------------------------------------------
// Dialect-aware DB introspection helpers
//
// The matrix means tests can't reach for sqlite_master / .prepare() etc.
// directly. These helpers paper over the two drivers so test bodies stay
// dialect-agnostic.
// ---------------------------------------------------------------------------

/** Return the rows from a raw SELECT, regardless of driver. */
export async function rawQuery(db: GameDatabase, sql: string): Promise<any[]> {
  const conn = (db as any).ownedConnection;
  // pglite: client.query(sql) -> { rows }
  if (typeof conn.query === 'function' && typeof conn.exec === 'function' && !conn.prepare) {
    const result = await conn.query(sql);
    return result.rows ?? [];
  }
  // postgres-js: tagged template / function; we don't use it in tests, but
  // calling `.unsafe(sql)` returns rows.
  if (typeof conn.unsafe === 'function') {
    return await conn.unsafe(sql);
  }
  // node:sqlite: .prepare(sql).all()
  return conn.prepare(sql).all();
}

/** List `colyseus_*` (or any LIKE-pattern) table names. */
export async function listTables(db: GameDatabase, like = 'colyseus_%'): Promise<string[]> {
  const sql = db.dialect === 'pg'
    ? `SELECT table_name AS name FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE '${like}'`
    : `SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '${like}'`;
  const rows = await rawQuery(db, sql);
  return rows.map((r: any) => r.name).sort();
}

/** True iff a table with the given exact name exists. */
export async function tableExists(db: GameDatabase, name: string): Promise<boolean> {
  const tables = await listTables(db, name);
  return tables.includes(name);
}


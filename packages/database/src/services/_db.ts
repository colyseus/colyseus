/**
 * Shared types/helpers used by the per-feature service classes
 * (AuthService, ConfigService, etc). Centralizing these means each service
 * file says `db: ServiceDb` instead of `db: any` — typos like `db.fetch(...)`
 * become a compile error, and the surface every service consumes is
 * documented in one place.
 *
 * The leading underscore in the filename is a convention — it sorts to the
 * top of the directory listing, signaling "internal helper, not a service".
 */

/**
 * Narrow contract every service uses against the drizzle client. Both
 * dialect-specific drizzle classes (`BaseSQLiteDatabase`, `PgAsyncDatabase`)
 * satisfy this shape, so `database.drizzle` from any GameDatabase is
 * assignable to it.
 *
 * Method signatures use plain `any` (no generics) on purpose — drizzle's
 * own methods are heavily overloaded with generic constraints that don't
 * unify with the dialect-union TS computes for `database.drizzle`. A
 * generic ServiceDb signature would break that assignability. Chain
 * return types are loose for the same reason; the win here is just at
 * the call boundary (typos like `db.fetch(...)` become an error) plus
 * documenting the actual surface services use.
 */
export interface ServiceDb {
  select(fields?: any): any;
  selectDistinct(fields?: any): any;
  insert(table: any): any;
  update(table: any): any;
  delete(table: any): any;
  /** Optional — pg + sqlite both have it, but a custom adapter might not. */
  transaction?(fn: (tx: any) => Promise<any>): Promise<any>;
}

/**
 * Drizzle's `.delete().where(...)` (without `.returning()`) returns a
 * dialect-specific shape we need a uniform integer from:
 *
 *   sqlite (node)         → { changes, lastInsertRowid }
 *   sqlite (better-sqlite)→ { changes, lastInsertRowid }
 *   postgres-js           → { count }
 *   pglite                → { affectedRows }
 *
 * Until drizzle ships a unified result type, this consolidates the fan-out.
 * Returns 0 for unrecognized shapes (defensive — callers usually only care
 * "was anything deleted").
 */
export function affectedRows(result: unknown): number {
  if (result == null || typeof result !== 'object') { return 0; }
  const r = result as Record<string, unknown>;
  const candidate =
    r.changes ?? r.rowsAffected ?? r.affectedRows ?? r.count;
  return Number(candidate ?? 0);
}

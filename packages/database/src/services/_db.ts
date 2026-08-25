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
 * The shape services see for `db`. We tried two stricter alternatives
 * before settling here:
 *
 *  1. `BaseSQLiteDatabase<...> | PgAsyncDatabase<...>` (concrete union)
 *     — drizzle's per-method overload signatures across the two
 *     dialects don't unify, so `db.select(...)` errored with
 *     "expression is not callable" at every call site.
 *  2. `DrizzleDbFor<Dialect>` conditional, fed via a service-level
 *     `Dialect extends 'sqlite' | 'pg'` generic — TS only resolves
 *     the conditional once the generic is bound, so inside class
 *     methods (where the generic is still abstract) `this.db`
 *     resolves to the un-narrowed conditional union with the same
 *     "not callable" failure.
 *
 * Plain interface with `any` returns is what works. Win at this level:
 * typos like `db.fetch(...)` become a compile error, and the actual
 * surface every service consumes is documented in one place. Chain
 * return types stay loose — pinning them would require a per-service
 * coupling to a specific drizzle subclass that TS doesn't let us
 * express across the dialect dispatch.
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

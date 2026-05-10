/**
 * Pure helpers used by the admin endpoints. None of these touch a logger,
 * a Response, or a closure — they all operate on plain values + drizzle
 * column/table metadata, which makes them trivially unit-testable (see
 * `test/helpers.test.ts`-equivalents).
 *
 * Sections:
 *   1. Drizzle table introspection types  — narrow duck-typed shapes
 *   2. Composite-id codec                  — base64url JSON tuple <-> array
 *   3. Type coercion at the request edge   — castPk, castFilterValue, coerceForColumn
 *   4. Body translation                    — SQL keys → JS keys + value coercion
 *   5. Primary-key plumbing                — pkColumns, buildPkWhere
 *   6. Query construction                  — sqlKeyedProjection, listColumns, buildFilterCondition
 *   7. Audit fire-and-forget wrapper       — tryAudit
 */
import { and, eq, gt, gte, inArray, like, lt, lte, ne, type SQL } from 'drizzle-orm';
import type { ResourceDefinition } from './define-resource.js';
import type { Logger } from './logger.js';

// ---------------------------------------------------------------------------
// 1. Drizzle table introspection types
// ---------------------------------------------------------------------------

/**
 * Narrow duck-typed shape of a single drizzle column. Both `pg-core` and
 * `sqlite-core` expose structurally identical fields for the bits we use;
 * importing drizzle's strict types would force a dialect choice for no
 * benefit. Adding a new field used by helpers means widening this — TS
 * will then flag every call site that needs updating.
 */
export interface TableColumn {
  /** SQL column name. */
  name: string;
  /** True for single-column primary keys. Composite PKs go on cfg.primaryKeys. */
  primary: boolean;
  notNull: boolean;
  hasDefault?: boolean;
  /** Drizzle's $defaultFn marker — used together with hasDefault for the catalog. */
  defaultFn?: any;
  /** sqlite-core sets this to `true` for `integer().primaryKey({ autoIncrement: true })`. */
  autoIncrement?: boolean;
  /**
   * JS-side category drizzle reports — 'date', 'json', 'number', 'string',
   * 'boolean', etc. May appear as space-separated tokens for some shapes
   * (drizzle 1.0+ emits 'object date' for `integer({ mode: 'timestamp' })`
   * and 'number int53' for plain integers); consumers tokenize on whitespace.
   * Distinguishes timestamp-mode integers from regular ones.
   */
  dataType?: string;
  /** Returns the dialect's SQL type, e.g. "integer", "text", "timestamp". */
  getSQLType?(): string;
}

export interface TableConfig {
  /** Physical table name (the one passed to sqliteTable / pgTable). */
  name: string;
  columns: TableColumn[];
  /** Composite primary key constraints. Empty/undefined when single-column PK. */
  primaryKeys?: Array<{ columns: TableColumn[] }>;
}

// ---------------------------------------------------------------------------
// 2. Composite-id codec — server-side mirror of the frontend codec in
//    src/lib/composite-id.ts. Decodes the base64url-of-JSON-array shape
//    the UI produces for composite-PK tables (cloudSaves,
//    leaderboardEntries, playerItems, modAssignments).
// ---------------------------------------------------------------------------

export function decodeCompositeId(encoded: string): unknown[] {
  let b64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) { b64 += '='; }
  const json = Buffer.from(b64, 'base64').toString('utf-8');
  const parsed = JSON.parse(json);
  if (!Array.isArray(parsed)) {
    throw new Error('decodeCompositeId: expected an array');
  }
  return parsed;
}

/**
 * Decode `encoded` if the resource has multiple PK columns, otherwise
 * return a single-element array. Idempotent — callers can branch
 * uniformly on the resulting tuple.
 */
export function tryDecodeCompositeId(encoded: string, pkCols: ReadonlyArray<unknown>): unknown[] {
  if (pkCols.length <= 1) { return [encoded]; }
  return decodeCompositeId(encoded);
}

// ---------------------------------------------------------------------------
// 3. Type coercion at the request edge.
//
//    Two flavors:
//      - castFilterValue : query-string filters (`?col_gte=2024-01-01`)
//      - coerceForColumn : JSON request bodies sent by the form
//    Both inspect drizzle's `c.dataType` (the JS-side category) rather
//    than the SQL type so behavior is uniform across pg + sqlite.
// ---------------------------------------------------------------------------

/**
 * PK type cast: `'integer' | 'serial' | 'bigint'` SQL types come in as
 * strings on the URL but drizzle's `eq()` needs a number. Everything
 * else passes through as-is.
 */
export function castPk(raw: string, col: TableColumn): any {
  const t = col.getSQLType?.();
  if (t === 'integer' || t === 'serial' || t === 'bigint') { return Number(raw); }
  return raw;
}

/**
 * Coerce a query-string filter value into the column's expected JS type
 * before passing it to drizzle's comparison operators.
 */
export function castFilterValue(raw: string, col: TableColumn): any {
  const dt = col.dataType;
  if (dt === 'number') {
    const n = Number(raw);
    return Number.isFinite(n) ? n : raw;
  }
  if (dt === 'date') {
    const d = new Date(raw);
    return isNaN(d.getTime()) ? raw : d;
  }
  if (dt === 'boolean') {
    return raw === 'true' || raw === '1';
  }
  if (dt === 'json') {
    try { return JSON.parse(raw); } catch { return raw; }
  }
  return raw;
}

/**
 * Cast a JSON-body value to what drizzle's column expects. Empty strings
 * become null so optional fields can clear; unknown columns pass through
 * unchanged.
 *
 * Why this exists: the frontend's datetime-local inputs send strings
 * like "2026-05-08T22:05" — drizzle's `mapToDriverValue` then calls
 * `value.getTime()` and throws because a string has no such method.
 * Same for numbers (form values can be strings) and JSON (CodeMirror
 * gives back a string).
 */
export function coerceForColumn(value: any, col: TableColumn | null | undefined): any {
  if (value === null || value === undefined) { return value; }
  if (!col) { return value; }
  const dt: string = col.dataType ?? '';
  const tokens = new Set(dt.split(/\s+/));

  // Empty string → null. Lets users clear nullable fields by emptying
  // the input rather than typing the literal word "null".
  if (typeof value === 'string' && value === '' && !tokens.has('string')) {
    return null;
  }

  if (tokens.has('date')) {
    if (value instanceof Date) { return value; }
    if (typeof value === 'string' || typeof value === 'number') {
      const d = new Date(value);
      return isNaN(d.getTime()) ? null : d;
    }
    return value;
  }

  if (tokens.has('number') || tokens.has('bigint')) {
    if (typeof value === 'number') { return value; }
    if (typeof value === 'string' && value.trim() !== '') {
      const n = Number(value);
      return Number.isFinite(n) ? n : value;
    }
    return value;
  }

  if (tokens.has('boolean')) {
    if (typeof value === 'boolean') { return value; }
    if (typeof value === 'string') { return value === 'true' || value === '1'; }
    if (typeof value === 'number') { return value !== 0; }
    return value;
  }

  if (tokens.has('json')) {
    if (typeof value !== 'string') { return value; }
    try { return JSON.parse(value); } catch { return value; }
  }

  return value;
}

// ---------------------------------------------------------------------------
// 4. Body translation — frontend posts SQL column names; drizzle wants JS
//    field names. Without this, drizzle's `.values({...})` and `.set({...})`
//    silently drop unrecognized keys and a NOT NULL FK ends up null.
// ---------------------------------------------------------------------------

export function translateBodyKeys(body: Record<string, any>, table: any): Record<string, any> {
  const sqlToJs: Record<string, string> = {};
  const colByJsKey: Record<string, TableColumn> = {};
  for (const [jsKey, col] of Object.entries(table)) {
    if (col && typeof col === 'object' && 'name' in (col as any) && typeof (col as any).name === 'string') {
      const tc = col as TableColumn;
      sqlToJs[tc.name] = jsKey;
      colByJsKey[jsKey] = tc;
    }
  }
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(body)) {
    const jsKey = sqlToJs[k] ?? k;
    const col = colByJsKey[jsKey];
    out[jsKey] = coerceForColumn(v, col);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 5. Primary-key plumbing — figuring out what columns make up the PK and
//    building the WHERE clause to address a single row by id.
//
//    `buildPkWhere` returns a discriminated union rather than a Response
//    so it stays unit-testable without HTTP coupling. The caller (admin
//    endpoints) maps `{ ok: false, status, message }` into errorResponse.
// ---------------------------------------------------------------------------

/**
 * The PK columns for a resource, in declaration order:
 *   - Single-column PKs surface via `c.primary === true` on the column.
 *   - Composite PKs are stored on `cfg.primaryKeys[].columns` instead.
 * Returns `[]` for tables without any PK (which makes row-level
 * Get/Update/Delete unsupported by definition).
 */
export function pkColumns(cfg: TableConfig): TableColumn[] {
  const single = cfg.columns.filter((c) => c.primary);
  if (single.length > 0) { return single; }
  return (cfg.primaryKeys ?? [])[0]?.columns ?? [];
}

export type BuildPkWhereResult =
  | { ok: true; where: SQL }
  | { ok: false; status: number; message: string };

/**
 * Build the `WHERE pk1=v1 AND pk2=v2 ...` predicate for a row identified
 * by `id`. For single-PK tables `id` is the bare value; for composite-PK
 * tables it's the base64url-of-JSON-array shape produced by the
 * frontend's `encodeCompositeId`.
 */
export function buildPkWhere(cfg: TableConfig, id: string): BuildPkWhereResult {
  const cols = pkColumns(cfg);
  if (cols.length === 0) {
    return { ok: false, status: 400, message: 'resource has no primary key' };
  }
  let values: unknown[];
  try {
    values = tryDecodeCompositeId(id, cols);
  } catch (err: any) {
    return { ok: false, status: 400, message: `invalid composite id: ${err?.message ?? String(err)}` };
  }
  if (values.length !== cols.length) {
    return {
      ok: false, status: 400,
      message: `composite id arity mismatch: expected ${cols.length}, got ${values.length}`,
    };
  }
  const conds = cols.map((col, i) => eq(col as any, castPk(String(values[i]), col)));
  const where = (conds.length === 1 ? conds[0] : and(...conds)) as SQL;
  return { ok: true, where };
}

// ---------------------------------------------------------------------------
// 6. Query construction — building SELECT projection, list-column subset,
//    and per-column WHERE conditions for the list endpoint.
// ---------------------------------------------------------------------------

/**
 * Build a drizzle projection keyed by SQL column names so the response
 * rows match what the frontend expects. Without this, drizzle's default
 * `select()` returns rows keyed by the JS field names (camelCase) and
 * the column metadata we expose to the UI uses snake_case — every
 * `record[c.name]` lookup misses for any column whose JS and SQL names
 * differ (createdAt / created_at, userId / user_id, etc.).
 */
export function sqlKeyedProjection(cfg: TableConfig): Record<string, TableColumn> {
  const out: Record<string, TableColumn> = {};
  for (const c of cfg.columns) { out[c.name] = c; }
  return out;
}

export function listColumns(cfg: TableConfig, def: ResourceDefinition | undefined): string[] {
  if (def?.list?.columns) { return def.list.columns; }
  return cfg.columns.map((c) => c.name);
}

/** Build a drizzle WHERE condition from `(col, op, rawValue)`. */
export function buildFilterCondition(col: TableColumn, op: string, raw: string): SQL | undefined {
  if (op === 'like') {
    // LIKE only makes sense on text-ish columns; otherwise fall through
    // to an eq match.
    return like(col as any, `%${raw}%`);
  }
  if (op === 'in') {
    // Comma-separated list — `?col_in=a,b,c`. Used by the admin's batched
    // FK label lookup so a list page only fires one query per FK column,
    // regardless of row count. Empty input returns undefined (no condition).
    const items = raw.split(',')
      .map((v) => v.trim())
      .filter((v) => v.length > 0)
      .map((v) => castFilterValue(v, col));
    return items.length > 0 ? inArray(col as any, items) : undefined;
  }
  const v = castFilterValue(raw, col);
  switch (op) {
    case 'eq':  return eq(col as any, v);
    case 'ne':  return ne(col as any, v);
    case 'gt':  return gt(col as any, v);
    case 'gte': return gte(col as any, v);
    case 'lt':  return lt(col as any, v);
    case 'lte': return lte(col as any, v);
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// 7. Audit fire-and-forget wrapper — wraps audit-log writes so a failure
//    to log never breaks the user's mutation. Errors land in the admin
//    logger (when one is configured) so operators can debug.
// ---------------------------------------------------------------------------

export async function tryAudit(logger: Logger | null, work: () => Promise<unknown>): Promise<void> {
  try { await work(); }
  catch (err: any) {
    logger?.error?.({ err: err?.message ?? String(err) }, 'audit log write failed');
  }
}

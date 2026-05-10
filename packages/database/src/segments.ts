/**
 * Segment definitions — declarative cohorts of users used by live-ops
 * features (mailbox, A/B experiments, targeted configs, push).
 *
 * v1 design: segments are defined in code, not in the admin UI.
 * - Devs author them next to the rest of their schema and import them at
 *   boot — type-safe, IDE-aware, version-controlled, no SQL injection
 *   surface in the admin.
 * - Admin shows the list, member counts, and individual members; it does
 *   NOT let operators rewrite the rules from the panel. UI-editable rules
 *   are a separate, future story (v2) sitting on top of this primitive.
 *
 * Two definition shapes:
 *
 *   1. `where(ctx)` returning a drizzle SQL predicate over the users
 *      table. Preferred — the service composes `count(*)`, `EXISTS`, and
 *      `LIMIT/OFFSET` directly, so size / has / paginated ids never
 *      materialize the full cohort. Use this for "users with property X".
 *
 *   2. `resolve(ctx)` returning a fully materialized `string[]` of user
 *      ids. Fallback — works for any shape (cross-table aggregates,
 *      external API calls), but size + has + ids load every id into
 *      memory. Acceptable for small/admin-only segments; switch to
 *      `where` once a cohort grows.
 *
 * Exactly one of `where` / `resolve` must be provided.
 */

import type { SQL, ExtractTablesFromSchema, ExtractTablesWithRelations } from 'drizzle-orm';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import type { PgAsyncDatabase } from 'drizzle-orm/pg-core/async';

/**
 * Auto-built relational config for the user's schema. GameDatabase calls
 * `defineRelations(schemas)` at boot time with no joins declared, which is
 * enough to wire `db.query.<table>.findMany()` for both dialects.
 *
 * Implemented as the underlying `ExtractTablesWithRelations<{}, ...>` type
 * rather than `ReturnType<typeof defineRelations<S>>` because TS doesn't
 * propagate the schema generic through `ReturnType<typeof fn<T>>` when the
 * resulting type is then used as another generic argument — the keys
 * collapse to `{}` and `db.query.<table>` stops resolving.
 */
type RelationsFor<S extends Record<string, any>> =
  ExtractTablesWithRelations<{}, ExtractTablesFromSchema<S>>;

/**
 * Public type for the `database.drizzle` field. Both dialects expose
 * `.select()`, `.insert()`, `.update()`, `.delete()`, AND `.query.<table>`
 * for the relational query API:
 *
 *   await database.drizzle.query.users.findFirst({ where: eq(users.id, '...') });
 *
 * The `.query` API is built from the `relations` arg passed at boot. Joins
 * (`with: { ... }`) require explicit `defineRelations(schema, helpers => ...)`
 * — see GameDatabase boot methods for how to wire that.
 */
export type DrizzleFor<
  S extends Record<string, any>,
  Dialect extends 'sqlite' | 'pg',
> = Dialect extends 'pg'
  ? PgAsyncDatabase<any, RelationsFor<S>>
  : BaseSQLiteDatabase<'sync' | 'async', any, S, RelationsFor<S>>;

export interface SegmentResolveContext<
  S extends Record<string, any>,
  Dialect extends 'sqlite' | 'pg' = 'sqlite',
> {
  /** The underlying drizzle client — same instance as `db.drizzle`. */
  drizzle: DrizzleFor<S, Dialect>;
  /**
   * Resolved drizzle tables, keyed by canonical name (users, configs, ...)
   * plus any custom tables added via the `schemas` option to GameDatabase.
   * Type is exactly the schema you passed when creating the definer.
   */
  tables: S;
  /** Captured at the start of resolution; lets resolvers be deterministic. */
  now: Date;
}

type LooseCtx = { drizzle: any; tables: Record<string, any>; now: Date };

/**
 * Stored shape of a segment after registration. The schema + dialect
 * generics are intentionally erased at this boundary so segments
 * authored against different schemas can be registered together.
 *
 * Exactly one of `where` / `resolve` is set on each definition; the
 * service prefers `where` whenever present for efficient COUNT / EXISTS
 * paths.
 */
export interface SegmentDefinition {
  /** Stable, unique identifier — used as a URL slug + as the lookup key. */
  id: string;
  /** Human-readable description shown in the admin UI. Optional. */
  description?: string;
  /**
   * SQL predicate over the users table. Composable: the service wraps it
   * in `count(*)`, `EXISTS`, or paginated SELECT depending on the call.
   * `undefined` means "no rows match" — useful for short-circuiting.
   */
  where?: (ctx: LooseCtx) => SQL | undefined;
  /**
   * Materialized resolver returning user ids. Fallback for shapes a
   * single users-table predicate can't express. Service uses it as-is
   * for ids/size/has, so cost scales with cohort size.
   */
  resolve?: (ctx: LooseCtx) => Promise<string[]>;
}

/**
 * Strictly-typed config accepted by a segment definer. Exactly one of
 * `where` / `resolve` must be provided — the discriminated union enforces
 * this at compile time.
 */
export type SegmentDefineConfig<
  S extends Record<string, any>,
  Dialect extends 'sqlite' | 'pg' = 'sqlite',
> =
  | {
      description?: string;
      where: (ctx: SegmentResolveContext<S, Dialect>) => SQL | undefined;
      resolve?: never;
    }
  | {
      description?: string;
      resolve: (ctx: SegmentResolveContext<S, Dialect>) => Promise<string[]>;
      where?: never;
    };

/**
 * The strictly-typed `defineSegment` returned by `createSegmentDefiner<S, Dialect>()`.
 * Closes over the schema + dialect generics so each call's resolver sees
 * the right `tables` and `drizzle` types.
 */
export type SegmentDefiner<
  S extends Record<string, any>,
  Dialect extends 'sqlite' | 'pg' = 'sqlite',
> = (id: string, config: SegmentDefineConfig<S, Dialect>) => SegmentDefinition;

/**
 * Build a `defineSegment` function pre-bound to your schema. Both `tables`
 * and `drizzle` inside the resolver are strictly typed against `S`.
 *
 *   import * as schema from './db/schema.ts';
 *   const defineSegment = createSegmentDefiner<typeof schema>();        // sqlite
 *   const defineSegment = createSegmentDefiner<typeof schema, 'pg'>();  // postgres
 *
 * Pass `import * as schema` (a barrel of named table exports) — this is
 * the same shape `GameDatabase({ schemas })` accepts, so a single import
 * covers both code paths.
 */
export function createSegmentDefiner<
  S extends Record<string, any>,
  Dialect extends 'sqlite' | 'pg' = 'sqlite',
>(): SegmentDefiner<S, Dialect> {
  return (id, config) => buildDefinition(id, config as Omit<SegmentDefinition, 'id'>);
}

/**
 * Loose form for cases where typing the schema isn't worth it (small
 * scripts, test fixtures). Inside the resolver, `tables` is `Record<string,
 * any>` and `drizzle` is the union — no autocomplete.
 *
 * For real apps, prefer `createSegmentDefiner<typeof schema>()`.
 */
export function defineSegment(
  id: string,
  config: Omit<SegmentDefinition, 'id'>,
): SegmentDefinition {
  return buildDefinition(id, config);
}

function buildDefinition(
  id: string,
  config: Omit<SegmentDefinition, 'id'>,
): SegmentDefinition {
  if (!id || typeof id !== 'string') {
    throw new Error('[defineSegment] id must be a non-empty string');
  }
  const hasWhere = typeof config.where === 'function';
  const hasResolve = typeof config.resolve === 'function';
  if (hasWhere === hasResolve) {
    throw new Error(
      `[defineSegment] segment '${id}' must provide exactly one of 'where' or 'resolve' (got ${
        hasWhere && hasResolve ? 'both' : 'neither'
      })`,
    );
  }
  return { id, description: config.description, where: config.where, resolve: config.resolve };
}

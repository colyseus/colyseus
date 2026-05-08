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
 * Usage — `createSegmentDefiner<Schema, Dialect>()` captures your schema
 * + dialect once so `tables` and `drizzle` are both strictly typed inside
 * every resolver:
 *
 *   import * as schema from './db/schema.ts';
 *   import { createSegmentDefiner } from '@colyseus/database';
 *   import { gte } from 'drizzle-orm';
 *
 *   const defineSegment = createSegmentDefiner<typeof schema>();   // 'sqlite' default
 *   //  for postgres: createSegmentDefiner<typeof schema, 'pg'>();
 *
 *   export const veterans = defineSegment('veterans', {
 *     description: 'Level >= 10',
 *     resolve: async ({ drizzle, tables }) => {
 *       const rows = await drizzle
 *         .select({ id: tables.users.id })   // tables.users.id: typed column
 *         .from(tables.users)
 *         .where(gte(tables.users.level, 10));
 *       return rows.map((r) => r.id);
 *     },
 *   });
 */

import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import type { PgAsyncDatabase } from 'drizzle-orm/pg-core/async';

/**
 * Resolves to the drizzle client class for `Dialect`. SQLite carries the
 * schema in its generic so `.select().from(tables.x)` infers row shapes;
 * Postgres infers from the table arg alone, so the schema isn't threaded
 * into the type at this level.
 */
export type DrizzleFor<
  S extends Record<string, any>,
  Dialect extends 'sqlite' | 'pg',
> = Dialect extends 'pg'
  ? PgAsyncDatabase<any, any>
  : BaseSQLiteDatabase<'sync' | 'async', any, S>;

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

/**
 * Stored shape of a segment after `defineSegment(...)` returns. The
 * schema + dialect generics are intentionally erased at this boundary so
 * segments authored against different schemas can be registered together.
 *
 * The `resolve` ctx is loose here on purpose: the strict typing lives at
 * authoring time (inside the `createSegmentDefiner<S, D>()` factory), not
 * at the registration boundary the SegmentsService consumes.
 */
export interface SegmentDefinition {
  /** Stable, unique identifier — used as a URL slug + as the lookup key. */
  id: string;
  /** Human-readable description shown in the admin UI. Optional. */
  description?: string;
  /** Returns the list of user ids in this segment at call time. */
  resolve: (ctx: { drizzle: any; tables: Record<string, any>; now: Date }) => Promise<string[]>;
}

/**
 * The strictly-typed `defineSegment` returned by `createSegmentDefiner<S, Dialect>()`.
 * Closes over the schema + dialect generics so each call's resolver sees
 * the right `tables` and `drizzle` types.
 */
export type SegmentDefiner<
  S extends Record<string, any>,
  Dialect extends 'sqlite' | 'pg' = 'sqlite',
> = (
  id: string,
  config: {
    description?: string;
    resolve: (ctx: SegmentResolveContext<S, Dialect>) => Promise<string[]>;
  },
) => SegmentDefinition;

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
  return (id, config) => {
    if (!id || typeof id !== 'string') {
      throw new Error('[defineSegment] id must be a non-empty string');
    }
    return {
      id,
      description: config.description,
      // The resolve signature widens at the registration boundary — same
      // erasure as making segments interchangeable at the GameDatabase level.
      resolve: config.resolve as SegmentDefinition['resolve'],
    };
  };
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
  if (!id || typeof id !== 'string') {
    throw new Error('[defineSegment] id must be a non-empty string');
  }
  return { id, ...config };
}

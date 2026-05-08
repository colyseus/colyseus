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
 * @example
 *   import { defineSegment } from '@colyseus/database';
 *   import { gte, sql } from 'drizzle-orm';
 *
 *   export const whales = defineSegment('whales', {
 *     description: 'Players who spent > $50 in the last 30 days',
 *     resolve: async ({ drizzle, tables }) => {
 *       const cutoff = new Date(Date.now() - 30 * 86400_000);
 *       const rows = await drizzle
 *         .select({ id: tables.transactions.userId })
 *         .from(tables.transactions)
 *         .where(gte(tables.transactions.createdAt, cutoff))
 *         .groupBy(tables.transactions.userId)
 *         .having(sql`sum(${tables.transactions.amount}) > 50`);
 *       return rows.map((r: { id: string }) => r.id);
 *     },
 *   });
 *
 *   new GameDatabase({ segments: [whales] });
 */

export interface SegmentResolveContext {
  /** The underlying drizzle client — same as `db.drizzle`. */
  drizzle: any;
  /**
   * Resolved drizzle tables, keyed by canonical name (users, configs, ...)
   * plus any custom tables added via the `tables` option to GameDatabase.
   */
  tables: Record<string, any>;
  /** Captured at the start of resolution; lets resolvers be deterministic. */
  now: Date;
}

export interface SegmentDefinition {
  /** Stable, unique identifier — used as a URL slug + as the lookup key. */
  id: string;
  /** Human-readable description shown in the admin UI. Optional. */
  description?: string;
  /** Returns the list of user ids in this segment at call time. */
  resolve: (ctx: SegmentResolveContext) => Promise<string[]>;
}

/**
 * Identity helper that adds typed inference over inline literals. Returns
 * the same shape it received — purely a documentation/discovery aid.
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

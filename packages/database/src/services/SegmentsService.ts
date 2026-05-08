import type { SegmentDefinition, SegmentResolveContext } from '../segments.ts';

/**
 * Runtime accessor + registration point for player segments.
 *
 * The service is constructed eagerly by GameDatabase so `db.segments.define(...)`
 * is available before `boot()`. It buffers definitions until boot calls the
 * internal `__attach` hook with the live drizzle client + resolved tables;
 * before that, methods that need DB access (size/ids/has/forEach) throw a
 * clear error so misordered code fails loudly.
 *
 * Materializes ids lazily — every read re-runs the segment's `resolve()`
 * against the live DB. For large or expensive segments, callers should
 * cache externally (e.g. a cron job that snapshots into a
 * `segment_membership` table). Future versions may grow first-class
 * materialization here.
 */
export class SegmentsService<
  S extends Record<string, any> = Record<string, any>,
  Dialect extends 'sqlite' | 'pg' = 'sqlite',
> {
  private drizzle: any = null;
  private tables: Record<string, any> = {};
  private byId: Map<string, SegmentDefinition> = new Map();
  private booted = false;

  /**
   * Attach the live drizzle client + resolved tables. Called by
   * GameDatabase at the end of `boot()`. Also accepts a final batch of
   * segments — the discriminated `options.segments` array — to merge with
   * anything already registered via `define`.
   *
   * @internal — not part of the public API.
   */
  __attach(drizzle: any, tables: Record<string, any>, extras: SegmentDefinition[] = []): void {
    this.drizzle = drizzle;
    this.tables = tables;
    for (const s of extras) {
      if (this.byId.has(s.id)) {
        throw new Error(`[SegmentsService] duplicate segment id: ${s.id}`);
      }
      this.byId.set(s.id, s);
    }
    this.booted = true;
  }

  /**
   * Register a segment with the service. Strictly typed via the
   * GameDatabase's schema + dialect generics — `tables` and `drizzle`
   * inside the resolver autocomplete against the user's actual schema.
   *
   * Safe to call at any time (before or after boot). Buffered definitions
   * are picked up when `__attach` runs.
   */
  define(
    id: string,
    config: {
      description?: string;
      resolve: (ctx: SegmentResolveContext<S, Dialect>) => Promise<string[]>;
    },
  ): SegmentDefinition {
    if (!id || typeof id !== 'string') {
      throw new Error('[SegmentsService.define] id must be a non-empty string');
    }
    if (this.byId.has(id)) {
      throw new Error(`[SegmentsService] duplicate segment id: ${id}`);
    }
    const def: SegmentDefinition = {
      id,
      description: config.description,
      resolve: config.resolve as SegmentDefinition['resolve'],
    };
    this.byId.set(id, def);
    return def;
  }

  /** Names + descriptions of every registered segment. Synchronous — no DB hit. */
  list(): Array<{ id: string; description?: string }> {
    return [...this.byId.values()].map(({ id, description }) => ({ id, description }));
  }

  /** Number of users currently in the segment. */
  async size(id: string): Promise<number> {
    const ids = await this.ids(id);
    return ids.length;
  }

  /** All user ids in the segment. Order is whatever the resolver returned. */
  async ids(id: string): Promise<string[]> {
    this.requireBoot('ids');
    const def = this.requireSegment(id);
    return def.resolve({ drizzle: this.drizzle, tables: this.tables, now: new Date() });
  }

  /** True iff the user is currently a member of the segment. */
  async has(id: string, userId: string): Promise<boolean> {
    const ids = await this.ids(id);
    return ids.includes(userId);
  }

  /**
   * Run an action over every member of the segment. The handler runs
   * sequentially so callers can rate-limit / observe progress; if you
   * need parallel execution, use Promise.all over the ids() result.
   */
  async forEach(id: string, fn: (userId: string) => Promise<void> | void): Promise<void> {
    const ids = await this.ids(id);
    for (const userId of ids) { await fn(userId); }
  }

  private requireBoot(method: string): void {
    if (!this.booted) {
      throw new Error(
        `[SegmentsService.${method}] not booted yet — call db.boot() before reading segment members`,
      );
    }
  }

  private requireSegment(id: string): SegmentDefinition {
    const def = this.byId.get(id);
    if (!def) {
      const known = [...this.byId.keys()].join(', ') || '<none>';
      throw new Error(`[SegmentsService] unknown segment '${id}' (known: ${known})`);
    }
    return def;
  }
}

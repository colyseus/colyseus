import { and, eq, sql, type SQL } from 'drizzle-orm';
import type { SegmentDefinition, SegmentDefineConfig, SegmentResolveContext } from '../segments.ts';
import type { ServiceDb } from './_db.ts';

/**
 * Runtime accessor + registration point for player segments.
 *
 * Two definition shapes are supported (see segments.ts for the full
 * authoring docs):
 *   - `where(ctx) => SQL`      — preferred; service composes
 *                                  count(*) / EXISTS / paginated SELECT.
 *                                  Cost is independent of cohort size.
 *   - `resolve(ctx) => string[]` — fallback; size/has must materialize the
 *                                  full member list. Cost is O(cohort).
 *
 * Eagerly constructed by GameDatabase so `db.segments.define(...)` is
 * available before `boot()`. Reads (size/ids/has/forEach) require boot
 * to have run; before that they throw a clear error so misordered code
 * fails loudly.
 */
export class SegmentsService<
  S extends Record<string, any> = Record<string, any>,
  Dialect extends 'sqlite' | 'pg' = 'sqlite',
> {
  // Nullable because the service is constructed pre-boot (so users can
  // call `db.segments.define(...)` before db.boot()); `__attach` fills
  // these in once drizzle + tables exist.
  private drizzle: ServiceDb | null = null;
  private tables: Record<string, unknown> = {};
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
  __attach(drizzle: ServiceDb, tables: Record<string, unknown>, extras: SegmentDefinition[] = []): void {
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
  define(id: string, config: SegmentDefineConfig<S, Dialect>): SegmentDefinition {
    if (!id || typeof id !== 'string') {
      throw new Error('[SegmentsService.define] id must be a non-empty string');
    }
    if (this.byId.has(id)) {
      throw new Error(`[SegmentsService] duplicate segment id: ${id}`);
    }
    const hasWhere = 'where' in config && typeof config.where === 'function';
    const hasResolve = 'resolve' in config && typeof config.resolve === 'function';
    if (hasWhere === hasResolve) {
      throw new Error(
        `[SegmentsService] segment '${id}' must provide exactly one of 'where' or 'resolve'`,
      );
    }
    const def: SegmentDefinition = {
      id,
      description: config.description,
      where: (config as { where?: any }).where,
      resolve: (config as { resolve?: any }).resolve,
    };
    this.byId.set(id, def);
    return def;
  }

  /** Names + descriptions of every registered segment. Synchronous — no DB hit. */
  list(): Array<{ id: string; description?: string }> {
    return [...this.byId.values()].map(({ id, description }) => ({ id, description }));
  }

  /**
   * Number of users currently in the segment.
   *
   * For `where`-based segments this is `SELECT count(*) FROM users WHERE
   * <predicate>` — a single integer round-trip, regardless of cohort size.
   * For `resolve`-based segments it materializes the full id list and
   * takes its `.length`.
   */
  async size(id: string): Promise<number> {
    const drizzle = this.requireBoot('size');
    const def = this.requireSegment(id);
    if (def.where) {
      const predicate = def.where(this.ctx());
      if (!predicate) { return 0; }
      const rows = await drizzle
        .select({ c: sql<number>`count(*)` })
        .from(this.usersTable())
        .where(predicate);
      return Number((rows[0] as { c?: number })?.c ?? 0);
    }
    return (await def.resolve!(this.ctx())).length;
  }

  /**
   * User ids in the segment. For `where`-based segments, supports
   * pagination via `limit`/`offset` (pushed into SQL). For `resolve`-based
   * segments, pagination slices the materialized array — the resolver
   * still loads everything.
   */
  async ids(id: string, opts: { limit?: number; offset?: number } = {}): Promise<string[]> {
    const drizzle = this.requireBoot('ids');
    const def = this.requireSegment(id);
    if (def.where) {
      const predicate = def.where(this.ctx());
      if (!predicate) { return []; }
      const users = this.usersTable();
      let q = drizzle
        .select({ id: users.id })
        .from(users)
        .where(predicate);
      if (opts.limit !== undefined) { q = q.limit(opts.limit); }
      if (opts.offset !== undefined) { q = q.offset(opts.offset); }
      const rows = await q;
      return (rows as Array<{ id: string }>).map((r) => r.id);
    }
    let materialized = await def.resolve!(this.ctx());
    if (opts.offset !== undefined) { materialized = materialized.slice(opts.offset); }
    if (opts.limit !== undefined) { materialized = materialized.slice(0, opts.limit); }
    return materialized;
  }

  /**
   * True iff the user is currently a member of the segment.
   *
   * For `where`-based segments this is a single `SELECT id FROM users
   * WHERE <predicate> AND id = ? LIMIT 1` — no full member list loaded.
   * For `resolve`-based segments it falls back to materialization.
   */
  async has(id: string, userId: string): Promise<boolean> {
    const drizzle = this.requireBoot('has');
    const def = this.requireSegment(id);
    if (def.where) {
      const predicate = def.where(this.ctx());
      if (!predicate) { return false; }
      const users = this.usersTable();
      const rows = await drizzle
        .select({ id: users.id })
        .from(users)
        .where(and(predicate, eq(users.id, userId)))
        .limit(1);
      return rows.length > 0;
    }
    return (await def.resolve!(this.ctx())).includes(userId);
  }

  /**
   * Run an action over every member of the segment. The handler runs
   * sequentially so callers can rate-limit / observe progress; if you
   * need parallel execution, use Promise.all over the ids() result.
   *
   * Loads ids in pages (default 1000) for `where`-based segments to
   * cap memory; resolve-based segments still materialize once.
   */
  async forEach(
    id: string,
    fn: (userId: string) => Promise<void> | void,
    opts: { pageSize?: number } = {},
  ): Promise<void> {
    this.requireBoot('forEach');
    const def = this.requireSegment(id);
    if (def.where) {
      const pageSize = opts.pageSize ?? 1000;
      let offset = 0;
      while (true) {
        const page = await this.ids(id, { limit: pageSize, offset });
        for (const userId of page) { await fn(userId); }
        if (page.length < pageSize) { break; }
        offset += pageSize;
      }
      return;
    }
    for (const userId of await def.resolve!(this.ctx())) { await fn(userId); }
  }

  // Loose return on ctx() — public callers (segment resolvers) expect to
  // see drizzle + tables typed via the SegmentResolveContext generic, not
  // the internal `ServiceDb`/`Record<string, unknown>`. The cast keeps
  // both honest: internals are narrow, callers see the rich generic.
  private ctx(): { drizzle: any; tables: Record<string, any>; now: Date } {
    return { drizzle: this.drizzle, tables: this.tables, now: new Date() };
  }

  private usersTable(): any {
    const t = this.tables.users;
    if (!t) {
      throw new Error("[SegmentsService] no `users` table on the database — required for `where` predicates");
    }
    return t;
  }

  /**
   * Throws when the service hasn't been attached yet; otherwise returns
   * the live drizzle client so the caller can use it without a non-null
   * assertion. `forEach` calls this for the side effect (it doesn't query
   * directly — it loops through `ids()` which re-checks).
   */
  private requireBoot(method: string): ServiceDb {
    if (!this.booted || !this.drizzle) {
      throw new Error(
        `[SegmentsService.${method}] not booted yet — call db.boot() before reading segment members`,
      );
    }
    return this.drizzle;
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

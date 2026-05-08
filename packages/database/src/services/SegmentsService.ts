import type { SegmentDefinition } from '../segments.ts';

/**
 * Runtime accessor over the registered segments. Materializes ids lazily
 * — every call re-runs the segment's `resolve()` against the live DB. For
 * large or expensive segments, callers should cache externally (e.g. a
 * cron job that snapshots into a `segment_membership` table). Future
 * versions may grow first-class materialization here.
 */
export class SegmentsService {
  private drizzle: any;
  private tables: Record<string, any>;
  private byId: Map<string, SegmentDefinition>;

  constructor(drizzle: any, tables: Record<string, any>, segments: SegmentDefinition[]) {
    this.drizzle = drizzle;
    this.tables = tables;
    this.byId = new Map();
    for (const s of segments) {
      if (this.byId.has(s.id)) {
        throw new Error(`[SegmentsService] duplicate segment id: ${s.id}`);
      }
      this.byId.set(s.id, s);
    }
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

  private requireSegment(id: string): SegmentDefinition {
    const def = this.byId.get(id);
    if (!def) {
      const known = [...this.byId.keys()].join(', ') || '<none>';
      throw new Error(`[SegmentsService] unknown segment '${id}' (known: ${known})`);
    }
    return def;
  }
}

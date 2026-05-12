import type { ServiceDb } from './_db.ts';

/**
 * Lightweight analytics event ingestion. `track(name, userId?, props?)`
 * appends a single row to the `analyticsEvents` table — that's the
 * whole service. Reporting (retention, funnels, cohort analysis) is
 * intentionally out of scope: running those queries against an OLTP
 * row store doesn't scale, and shipping a hand-rolled query layer
 * would hide that limitation from operators.
 *
 * For real analytics:
 *   - read the rows yourself via `db.drizzle.select().from(db.tables.analyticsEvents)`
 *     for tiny one-off checks
 *   - export to ClickHouse / BigQuery / Snowflake and report there
 *
 * The room-side AnalyticsPlugin auto-emits room lifecycle events into
 * this table; custom events go through `plugin.track('event_name', ...)`.
 */
import type { AnalyticsEventsTableShape } from '../types.ts';

export class AnalyticsService<T extends AnalyticsEventsTableShape = AnalyticsEventsTableShape> {
  private db: ServiceDb;
  private events: T;

  constructor(db: ServiceDb, events: T) {
    this.db = db;
    this.events = events;
  }

  async track(name: string, userId: string | null, props?: Record<string, unknown>): Promise<void> {
    await this.db.insert(this.events).values({ name, userId, props });
  }
}

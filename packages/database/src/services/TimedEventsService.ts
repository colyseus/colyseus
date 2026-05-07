import { and, eq, gte, lte } from 'drizzle-orm';

export interface TimedEvent {
  id: string;
  name: string;
  startsAt: Date;
  endsAt: Date;
  payload?: any;
}

/**
 * Time-windowed events (e.g. "double XP weekend"). Both `isActive` and `active`
 * accept an explicit `at` time so server code can check past/future windows
 * without relying on wall-clock time.
 */
import type { TimedEventsTableShape } from '../types.ts';

export class TimedEventsService<T extends TimedEventsTableShape = TimedEventsTableShape> {
  private db: any;
  private events: T;

  constructor(db: any, events: T) {
    this.db = db;
    this.events = events;
  }

  /**
   * Idempotently schedule an event. Re-running with the same id updates the window/payload.
   */
  async schedule(
    id: string,
    name: string,
    startsAt: Date,
    endsAt: Date,
    payload?: any,
  ): Promise<void> {
    await this.db
      .insert(this.events)
      .values({ id, name, startsAt, endsAt, payload })
      .onConflictDoUpdate({
        target: this.events.id,
        set: { name, startsAt, endsAt, payload },
      });
  }

  async cancel(id: string): Promise<void> {
    await this.db.delete(this.events).where(eq(this.events.id, id));
  }

  /** True iff the event id exists and `at` falls inside [startsAt, endsAt]. */
  async isActive(id: string, at: Date = new Date()): Promise<boolean> {
    const rows = await this.db
      .select({ id: this.events.id })
      .from(this.events)
      .where(and(
        eq(this.events.id, id),
        lte(this.events.startsAt, at),
        gte(this.events.endsAt, at),
      ))
      .limit(1);
    return rows.length > 0;
  }

  /** All events whose window covers `at`. */
  async active(at: Date = new Date()): Promise<TimedEvent[]> {
    return await this.db
      .select()
      .from(this.events)
      .where(and(
        lte(this.events.startsAt, at),
        gte(this.events.endsAt, at),
      ));
  }
}

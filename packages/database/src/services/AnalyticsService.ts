import { and, eq, gte, inArray, lt } from 'drizzle-orm';

export interface RetentionResult {
  cohortSize: number;
  returned: number;
  ratio: number;
}

export interface FunnelStep {
  step: string;
  users: number;
}

/**
 * Lightweight analytics — track named events with optional userId + props,
 * then compute classic retention/funnel queries against the table.
 *
 * Designed for prototyping and low-volume games. For serious volume, batch
 * ingestion into a dedicated OLAP store (ClickHouse, BigQuery) and treat
 * this table as the staging buffer.
 */
export class AnalyticsService {
  constructor(
    private db: any,
    private events: any,
  ) {}

  async track(name: string, userId: string | null, props?: Record<string, any>): Promise<void> {
    await this.db.insert(this.events).values({ name, userId, props });
  }

  /**
   * Of users who first did `cohortEvent` on `cohortDay` (UTC day),
   * what fraction did `returnEvent` on cohortDay+offset?
   */
  async retention(
    cohortEvent: string,
    returnEvent: string,
    cohortDay: Date,
    dayOffset: number,
  ): Promise<RetentionResult> {
    const dayStart = new Date(cohortDay);
    dayStart.setUTCHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

    const returnStart = new Date(dayStart);
    returnStart.setUTCDate(returnStart.getUTCDate() + dayOffset);
    const returnEnd = new Date(returnStart);
    returnEnd.setUTCDate(returnEnd.getUTCDate() + 1);

    const cohort = await this.db
      .selectDistinct({ uid: this.events.userId })
      .from(this.events)
      .where(and(
        eq(this.events.name, cohortEvent),
        gte(this.events.ts, dayStart),
        lt(this.events.ts, dayEnd),
      ));

    const cohortIds = cohort
      .map((c: { uid: string | null }) => c.uid)
      .filter((x: string | null): x is string => !!x);
    const cohortSize = cohortIds.length;
    if (cohortSize === 0) { return { cohortSize: 0, returned: 0, ratio: 0 }; }

    const returners = await this.db
      .selectDistinct({ uid: this.events.userId })
      .from(this.events)
      .where(and(
        eq(this.events.name, returnEvent),
        gte(this.events.ts, returnStart),
        lt(this.events.ts, returnEnd),
        inArray(this.events.userId, cohortIds),
      ));

    const returned = returners.length;
    return { cohortSize, returned, ratio: returned / cohortSize };
  }

  /**
   * For each step name, returns the count of distinct users who completed all
   * prior steps and this one. Order in the input array defines the funnel.
   */
  async funnel(steps: string[]): Promise<FunnelStep[]> {
    let prevUsers: string[] | null = null;
    const result: FunnelStep[] = [];

    for (const step of steps) {
      const conds: any[] = [eq(this.events.name, step)];
      if (prevUsers !== null) {
        if (prevUsers.length === 0) {
          result.push({ step, users: 0 });
          continue;
        }
        conds.push(inArray(this.events.userId, prevUsers));
      }

      const rows = await this.db
        .selectDistinct({ uid: this.events.userId })
        .from(this.events)
        .where(and(...conds));

      prevUsers = rows
        .map((r: { uid: string | null }) => r.uid)
        .filter((x: string | null): x is string => !!x);
      result.push({ step, users: prevUsers!.length });
    }

    return result;
  }
}

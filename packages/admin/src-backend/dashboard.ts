import { sql, desc, and, lte, gte } from 'drizzle-orm';
import type { GameDatabase } from '@colyseus/database';

/**
 * Server-side dashboard widget definition. Each widget runs server-side at
 * request time and produces a JSON payload the client renders by `render`.
 *
 * Built-in widgets (totals / recent users / active events / health) are
 * registered by default in `resolveWidgets()`. Pass `dashboard.widgets`
 * to `adminEndpoints({...})` to add new widgets or override defaults by id.
 */
export interface DashboardWidget {
  /** Unique id; reuse a default id (e.g. "totals") to override its data fn. */
  id: string;
  /** Display title; falls back to a humanized id. */
  title?: string;
  /** AntD icon name (sidebar icon set). */
  icon?: string;
  /**
   * Render hint for the client. Determines how `data` is interpreted:
   *   - 'kpi'   → Record<string, number | string> rendered as "label: value" cards
   *   - 'table' → { columns: string[]; rows: Record<string, any>[] }
   *   - 'list'  → Array<{ title: string; description?: string }>
   *   - 'json'  → anything; rendered as collapsible JSON
   */
  render?: 'kpi' | 'table' | 'list' | 'json';
  /** AntD col span (1–24). Defaults differ by render type. */
  span?: number;
  /** Server-side data fetcher. Errors are caught and surfaced as { error }. */
  data: (ctx: { database: GameDatabase; userId: string }) => Promise<unknown>;
}

/** Computed shape returned by GET /admin-api/_dashboard. */
export interface DashboardPayload {
  widgets: Array<{
    id: string;
    title: string;
    icon?: string;
    render: 'kpi' | 'table' | 'list' | 'json';
    span: number;
    /** widget data on success; null when `error` is set */
    data: unknown;
    /** error message if the widget's `data` function threw */
    error?: string;
  }>;
}

/**
 * Default span per render type. Tuned for a 24-col grid:
 * KPI cards stack 6+6+6+6 across one row; tables/lists take half-width.
 */
const DEFAULT_SPAN: Record<NonNullable<DashboardWidget['render']>, number> = {
  kpi: 24,
  table: 24,
  list: 12,
  json: 24,
};

function humanize(id: string): string {
  return id.replace(/[_-]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function builtIns(database: GameDatabase, knownTables: Record<string, any>): DashboardWidget[] {
  return [
    {
      id: 'totals',
      title: 'Totals',
      icon: 'pie-chart',
      render: 'kpi',
      data: async () => {
        const out: Record<string, number> = {};
        for (const [name, table] of Object.entries(knownTables)) {
          try {
            const rows = await database.drizzle
              .select({ c: sql<number>`count(*)` })
              .from(table);
            out[name] = Number((rows[0] as { c?: number })?.c ?? 0);
          } catch {
            out[name] = 0;
          }
        }
        return out;
      },
    },
    {
      id: 'recentUsers',
      title: 'Recent users',
      icon: 'team',
      render: 'table',
      data: async () => {
        const users = database.tables.users;
        // createdAt is a column on the default users table; respect a
        // customized table that lacks it by falling back to "no order".
        const hasCreatedAt = !!(users as any)?.createdAt;
        let q = database.drizzle.select().from(users).limit(5) as any;
        if (hasCreatedAt) { q = q.orderBy(desc((users as any).createdAt)); }
        const rows = await q;
        const columns = rows.length > 0 ? Object.keys(rows[0] as Record<string, any>) : [];
        return { columns, rows };
      },
    },
    {
      id: 'activeEvents',
      title: 'Active timed events',
      icon: 'clock-circle',
      render: 'list',
      data: async () => {
        const events = database.tables.timedEvents;
        const now = new Date();
        const rows = await database.drizzle
          .select()
          .from(events)
          .where(and(
            lte((events as any).startsAt, now),
            gte((events as any).endsAt, now),
          ))
          .limit(10);
        return (rows as Array<{ id: string; name: string; endsAt: Date }>).map((r) => ({
          title: r.name,
          description: `id=${r.id} · ends ${new Date(r.endsAt).toISOString()}`,
        }));
      },
    },
    {
      id: 'health',
      title: 'Database health',
      icon: 'heart',
      render: 'kpi',
      data: async () => {
        const start = Date.now();
        await database.drizzle
          .select({ one: sql<number>`1` })
          .from(database.tables.users)
          .limit(0);
        return { status: 'ok', latency: `${Date.now() - start}ms` };
      },
    },
  ];
}

/**
 * Merge user-provided widgets with the built-ins. Same-id widgets from the
 * user replace the built-in version; new ids are appended.
 */
export function resolveWidgets(
  database: GameDatabase,
  knownTables: Record<string, any>,
  userWidgets: DashboardWidget[] = [],
): DashboardWidget[] {
  const merged = new Map<string, DashboardWidget>();
  for (const w of builtIns(database, knownTables)) { merged.set(w.id, w); }
  for (const w of userWidgets) { merged.set(w.id, w); }
  return [...merged.values()];
}

/** Build the JSON payload for GET /_dashboard. Errors per-widget surface as `{ error }`. */
export async function runWidgets(
  widgets: DashboardWidget[],
  ctx: { database: GameDatabase; userId: string },
): Promise<DashboardPayload> {
  const results = await Promise.all(widgets.map(async (w) => {
    const render = w.render ?? 'json';
    const base = {
      id: w.id,
      title: w.title ?? humanize(w.id),
      icon: w.icon,
      render,
      span: w.span ?? DEFAULT_SPAN[render],
    };
    try {
      const data = await w.data(ctx);
      return { ...base, data };
    } catch (err: any) {
      return { ...base, data: null, error: err?.message ?? String(err) };
    }
  }));
  return { widgets: results };
}

import { sql, desc } from 'drizzle-orm';
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

/**
 * Built-in widget ids. Use as the discriminator for `dashboard.builtIns`.
 */
export type BuiltInWidgetId = 'totals' | 'recentUsers' | 'health' | 'segments';

/**
 * Factory functions for the built-in widgets. Re-usable as composition
 * primitives — call them directly inside your `widgets` array if you want
 * a default widget at a non-default position, or wrap their data fn:
 *
 *   import { dashboardWidgets } from '@colyseus/admin';
 *   dashboard: {
 *     builtIns: [],          // skip the auto-injection
 *     widgets: [
 *       dashboardWidgets.health(),
 *       dashboardWidgets.recentUsers({ limit: 10 }),
 *       myCustomRoomsWidget,
 *     ],
 *   }
 *
 * Each factory accepts a small options bag to tune title/icon/limit without
 * forking the whole widget.
 */
export const dashboardWidgets = {
  totals(opts: { title?: string; icon?: string; only?: string[] } = {}): DashboardWidget {
    return {
      id: 'totals',
      title: opts.title ?? 'Totals',
      icon: opts.icon ?? 'pie-chart',
      render: 'kpi',
      data: async ({ database }) => {
        const knownTables = database.tables as unknown as Record<string, any>;
        const entries = opts.only
          ? opts.only.map((k) => [k, knownTables[k]] as const).filter(([, t]) => !!t)
          : Object.entries(knownTables);
        const out: Record<string, number> = {};
        for (const [name, table] of entries) {
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
    };
  },

  recentUsers(opts: { title?: string; icon?: string; limit?: number } = {}): DashboardWidget {
    const limit = opts.limit ?? 5;
    return {
      id: 'recentUsers',
      title: opts.title ?? 'Recent users',
      icon: opts.icon ?? 'team',
      render: 'table',
      data: async ({ database }) => {
        const users = database.tables.users;
        const hasCreatedAt = !!(users as any)?.createdAt;
        let q = database.drizzle.select().from(users).limit(limit) as any;
        if (hasCreatedAt) { q = q.orderBy(desc((users as any).createdAt)); }
        const rows = await q;
        const columns = rows.length > 0 ? Object.keys(rows[0] as Record<string, any>) : [];
        return { columns, rows };
      },
    };
  },

  health(opts: { title?: string; icon?: string } = {}): DashboardWidget {
    return {
      id: 'health',
      title: opts.title ?? 'Database health',
      icon: opts.icon ?? 'heart',
      render: 'kpi',
      data: async ({ database }) => {
        const start = Date.now();
        await database.drizzle
          .select({ one: sql<number>`1` })
          .from(database.tables.users)
          .limit(0);
        return { status: 'ok', latency: `${Date.now() - start}ms` };
      },
    };
  },

  /**
   * Segment sizes — KPI of each registered segment's current member count.
   * Empty + hidden when no segments are defined on the GameDatabase.
   */
  segments(opts: { title?: string; icon?: string } = {}): DashboardWidget {
    return {
      id: 'segments',
      title: opts.title ?? 'Segments',
      icon: opts.icon ?? 'cluster',
      render: 'kpi',
      data: async ({ database }) => {
        const out: Record<string, number> = {};
        for (const { id } of database.segments.list()) {
          out[id] = await database.segments.size(id);
        }
        return out;
      },
    };
  },
};

const ALL_BUILT_INS: BuiltInWidgetId[] = ['totals', 'recentUsers', 'health', 'segments'];

/**
 * Resolve the final widget set for a request.
 *
 * @param builtIns Which built-ins to auto-include. Defaults to all four.
 *                 Pass `[]` to start with a blank slate.
 * @param userWidgets User widgets — override a built-in by reusing its id, or
 *                    append a new widget by giving it a fresh id.
 */
export function resolveWidgets(
  builtIns: BuiltInWidgetId[] | undefined,
  userWidgets: DashboardWidget[] = [],
): DashboardWidget[] {
  const selected = builtIns ?? ALL_BUILT_INS;
  const merged = new Map<string, DashboardWidget>();
  for (const id of selected) {
    merged.set(id, dashboardWidgets[id]());
  }
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

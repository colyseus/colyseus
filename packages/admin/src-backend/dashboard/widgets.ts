import { sql, desc } from 'drizzle-orm';
import { matchMaker } from '@colyseus/core';
import { POSTGRES_MAX_INTEGER } from '@colyseus/database';
import type { GameDatabase, sqliteUserColumns } from '@colyseus/database';
import type { AdminIconName } from '../display/icons.js';

/**
 * Column names of the framework's default `users` table. Derived from
 * `@colyseus/database`'s exported column map so adding a column there
 * surfaces in autocomplete here without further wiring.
 *
 * Paired with `(string & {})` in `UserColumnName` so user-added columns
 * on custom users tables are still accepted — the literal union only
 * powers IDE suggestions.
 */
type DefaultUserColumnName = keyof typeof sqliteUserColumns;

/**
 * A users-table column name. Autocompletes the framework defaults but
 * accepts any string (custom-extended schemas, joins, etc.).
 */
export type UserColumnName = DefaultUserColumnName | (string & {});

/**
 * Standard fields surfaced by `matchMaker.query({})` (mirrors the
 * `/admin-api/rooms` summary shape). Custom drivers can return extra
 * fields — the `(string & {})` pairing keeps them accepted.
 */
type DefaultLiveRoomColumnName =
  | 'roomId' | 'name' | 'clients' | 'maxClients' | 'locked' | 'private'
  | 'createdAt' | 'elapsedTime' | 'processId' | 'publicAddress';
export type LiveRoomColumnName = DefaultLiveRoomColumnName | (string & {});

/**
 * Render mode for a dashboard widget — determines how the client
 * interprets the widget's `data`:
 *
 *   - 'kpi'   → Record<string, number | string> rendered as "label: value" cards
 *   - 'table' → TableWidgetData — { columns, rows, linkTo? }
 *   - 'list'  → Array<{ title: string; description?: string }>
 *   - 'json'  → anything; rendered as collapsible JSON
 */
export type WidgetRender = 'kpi' | 'table' | 'list' | 'json';

/**
 * Data shape expected for `render: 'table'` widgets. `columns` (raw column
 * keys) doubles as the header order; the client humanizes the labels for
 * display. When `linkTo` is set, the client makes each row clickable and
 * navigates to `/{resource}/show/{row[idColumn]}` (same UX as the standard
 * `/admin/<resource>` list).
 */
export interface TableWidgetData {
  columns: string[];
  rows: Array<Record<string, any>>;
  linkTo?: {
    /** Canonical admin resource name (e.g. 'users'). */
    resource: string;
    /** Column whose value is the row's primary key. Default 'id'. */
    idColumn?: string;
  };
}

/**
 * User-defined dashboard widget. `data` runs server-side at request time
 * and its return value is sent to the client as the widget's payload.
 *
 * `id` is optional — it defaults to a slugified `title` (e.g. "Live events"
 * → "live-events"). Set it explicitly when you want a stable identifier
 * for `data-testid="widget-<id>"` selectors independent of the title.
 */
export interface DashboardWidget {
  /** Stable id; defaults to slugify(title). Must not collide with a preset id. */
  id?: string;
  /** Display title (also the basis for the auto-derived `id`). */
  title: string;
  /** Icon name from the admin's icon set. */
  icon?: AdminIconName;
  /** Render hint for the client. Defaults to `'json'`. */
  render?: WidgetRender;
  /** 12-column grid span; default depends on render type. */
  span?: number;
  /**
   * When set, the client polls `GET /admin-api/_dashboard/<id>` at this
   * interval (ms) and refreshes the card in place. Useful for "live"
   * widgets (e.g. active rooms) that need to stay current without a
   * full dashboard reload.
   */
  refreshIntervalMs?: number;
  /** Server-side data fetcher. Errors are caught and surfaced as `{ error }`. */
  data: (ctx: { database: GameDatabase; userId: string }) => Promise<unknown>;
}

/** A single computed widget entry (also the shape of `/_dashboard/:widgetId`). */
export interface DashboardWidgetEntry {
  id: string;
  title: string;
  icon?: AdminIconName;
  render: WidgetRender;
  span: number;
  /** When > 0, the client polls /_dashboard/<id> on this cadence. */
  refreshIntervalMs?: number;
  /** widget data on success; null when `error` is set */
  data: unknown;
  /** error message if the widget's `data` function threw */
  error?: string;
}

/** Computed shape returned by GET /admin-api/_dashboard. */
export interface DashboardPayload {
  widgets: DashboardWidgetEntry[];
}

// ---------------------------------------------------------------------------
// Presets — built-in widgets with per-preset, strongly-typed options.
// ---------------------------------------------------------------------------

/** Options common to every preset. */
interface BasePresetOptions {
  /** Override the default display title. */
  title?: string;
  /** Override the default icon. */
  icon?: AdminIconName;
  /** 12-column grid span; falls back to the render-type default. */
  span?: number;
}

export interface TotalsPresetOptions extends BasePresetOptions {
  /** Restrict the row-count KPIs to a subset of table names. Default: all tables. */
  only?: string[];
}

export interface RecentUsersPresetOptions extends BasePresetOptions {
  /** Number of rows to fetch. Default 5. */
  limit?: number;
  /**
   * Subset of `users` table columns to display, in order. Unknown column
   * names are silently dropped. When omitted, returns all columns
   * (currently `Object.keys(rows[0])` — i.e. the full row).
   *
   * Autocompletes the framework's default user columns; user-extended
   * columns are still accepted (typed as `string`).
   *
   * @example columns: ['id', 'email', 'createdAt']
   */
  columns?: UserColumnName[];
}

export type HealthPresetOptions = BasePresetOptions;
export type SegmentsPresetOptions = BasePresetOptions;

export interface LiveRoomsPresetOptions extends BasePresetOptions {
  /** Max rows to show. Default 10. */
  limit?: number;
  /**
   * Columns to display, in order. Defaults to a compact summary
   * (`roomId`, `name`, `clients`, `maxClients`, `locked`, `createdAt`).
   * Pass other fields exposed by your matchmaker driver as raw strings.
   */
  columns?: LiveRoomColumnName[];
}

/**
 * Preset configuration map. Each preset is enabled by default; pass
 * `false` to disable, `true` (or omit) to use defaults, or an options
 * object to customize.
 *
 *   presets: {
 *     totals: { only: ['users', 'rooms'] },  // configure
 *     recentUsers: { limit: 10 },
 *     health: false,                         // disable
 *     // segments: omitted → default
 *   }
 */
export interface DashboardPresets {
  totals?:      boolean | TotalsPresetOptions;
  recentUsers?: boolean | RecentUsersPresetOptions;
  liveRooms?:   boolean | LiveRoomsPresetOptions;
  health?:      boolean | HealthPresetOptions;
  segments?:    boolean | SegmentsPresetOptions;
}

/** Fixed render order for preset widgets. */
const PRESET_ORDER = ['totals', 'recentUsers', 'liveRooms', 'health', 'segments'] as const;
type PresetId = (typeof PRESET_ORDER)[number];
const PRESET_IDS: ReadonlySet<string> = new Set(PRESET_ORDER);

/**
 * Default span per render type. Tuned for the 12-column UI grid:
 * KPI/table widgets take full width; list widgets take half.
 */
const DEFAULT_SPAN: Record<WidgetRender, number> = {
  kpi: 24,
  table: 24,
  list: 12,
  json: 24,
};

/** Internal-only resolved widget shape used by `runWidgets`. */
export interface ResolvedWidget {
  id: string;
  title: string;
  icon?: AdminIconName;
  render: WidgetRender;
  span: number;
  refreshIntervalMs?: number;
  data: (ctx: { database: GameDatabase; userId: string }) => Promise<unknown>;
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// ---------------------------------------------------------------------------
// Preset implementations. Each takes the merged options and returns a
// fully resolved widget. Kept private — `presets` is the public API.
// ---------------------------------------------------------------------------

function totalsWidget(opts: TotalsPresetOptions): ResolvedWidget {
  return {
    id: 'totals',
    title: opts.title ?? 'Totals',
    icon: opts.icon ?? 'pie-chart',
    render: 'kpi',
    span: opts.span ?? DEFAULT_SPAN.kpi,
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
}

function recentUsersWidget(opts: RecentUsersPresetOptions): ResolvedWidget {
  const limit = opts.limit ?? 5;
  return {
    id: 'recentUsers',
    title: opts.title ?? 'Recent users',
    icon: opts.icon ?? 'team',
    render: 'table',
    span: opts.span ?? DEFAULT_SPAN.table,
    data: async ({ database }): Promise<TableWidgetData> => {
      const users = database.tables.users as Record<string, any>;
      const hasCreatedAt = !!users?.createdAt;

      // If the caller asked for a column subset, project at SQL level
      // (faster + avoids leaking columns the dashboard never renders).
      // Unknown names are silently dropped.
      const projection = opts.columns
        ? Object.fromEntries(
            opts.columns
              .map((c) => [c, users[c]] as const)
              .filter(([, col]) => col !== undefined),
          )
        : undefined;

      const baseQuery = projection
        ? database.drizzle.select(projection).from(users as any)
        : database.drizzle.select().from(users as any);

      let q: any = (baseQuery as any).limit(limit);
      if (hasCreatedAt) { q = q.orderBy(desc(users.createdAt)); }

      const rows = await q as Array<Record<string, any>>;
      const columns = projection
        ? Object.keys(projection)
        : (rows.length > 0 ? Object.keys(rows[0]!) : []);
      return {
        columns,
        rows,
        linkTo: { resource: 'users', idColumn: 'id' },
      };
    },
  };
}

function liveRoomsWidget(opts: LiveRoomsPresetOptions): ResolvedWidget {
  const limit = opts.limit ?? 10;
  const columns = opts.columns
    ?? ['roomId', 'name', 'clients', 'maxClients', 'locked', 'createdAt'];
  return {
    id: 'liveRooms',
    title: opts.title ?? 'Live rooms',
    // Same glyph as the "Live rooms" sidebar entry (see App.tsx).
    icon: opts.icon ?? 'radio',
    render: 'table',
    span: opts.span ?? DEFAULT_SPAN.table,
    // Match the standalone /admin/rooms page's poll cadence so the
    // dashboard widget feels equally "live".
    refreshIntervalMs: 3000,
    data: async (): Promise<TableWidgetData> => {
      const rows = await matchMaker.query({}) as Array<Record<string, any>>;
      // Project to the same summary shape served by /admin-api/rooms so the
      // dashboard widget and the standalone Live rooms page agree.
      const summaries = rows.slice(0, limit).map((r) => ({
        roomId: r.roomId,
        name: r.name,
        clients: r.clients,
        // Unlimited rooms: DB drivers store Infinity as
        // POSTGRES_MAX_INTEGER; in-memory drivers send null over JSON.
        // The widget table has no per-column formatter, so emit the
        // display glyph directly (matches the Live rooms page's "∞").
        maxClients: (r.maxClients == null || r.maxClients === POSTGRES_MAX_INTEGER)
          ? '∞'
          : r.maxClients,
        locked: r.locked ?? false,
        private: r.private ?? false,
        createdAt: new Date(r.createdAt).toISOString(),
        elapsedTime: Date.now() - new Date(r.createdAt).getTime(),
        processId: r.processId ?? null,
        publicAddress: r.publicAddress ?? null,
      }));
      return {
        columns,
        rows: summaries,
        linkTo: { resource: 'rooms', idColumn: 'roomId' },
      };
    },
  };
}

function healthWidget(opts: HealthPresetOptions): ResolvedWidget {
  return {
    id: 'health',
    title: opts.title ?? 'Database health',
    icon: opts.icon ?? 'heart',
    render: 'kpi',
    span: opts.span ?? DEFAULT_SPAN.kpi,
    data: async ({ database }) => {
      const start = Date.now();
      await database.drizzle
        .select({ one: sql<number>`1` })
        .from(database.tables.users)
        .limit(0);
      return { status: 'ok', latency: `${Date.now() - start}ms` };
    },
  };
}

function segmentsWidget(opts: SegmentsPresetOptions): ResolvedWidget {
  return {
    id: 'segments',
    title: opts.title ?? 'Segments',
    icon: opts.icon ?? 'cluster',
    render: 'kpi',
    span: opts.span ?? DEFAULT_SPAN.kpi,
    data: async ({ database }) => {
      const out: Record<string, number> = {};
      for (const { id } of database.segments.list()) {
        out[id] = await database.segments.size(id);
      }
      return out;
    },
  };
}

const PRESET_BUILDERS: { [K in PresetId]: (opts: any) => ResolvedWidget } = {
  totals: totalsWidget,
  recentUsers: recentUsersWidget,
  liveRooms: liveRoomsWidget,
  health: healthWidget,
  segments: segmentsWidget,
};

/**
 * Resolve the final widget set for a request.
 *
 * @param presets    Preset configuration. Each preset is enabled with defaults
 *                   when omitted; pass `false` to disable, an options object
 *                   to customize. Default (when `presets` is omitted entirely):
 *                   all four presets enabled.
 * @param userWidgets User-defined custom widgets, appended after presets.
 *                   Their `id` defaults to slugify(title). Throws at setup
 *                   if any resolved id collides with a preset id or with
 *                   another user widget's id.
 */
export function resolveWidgets(
  presets: DashboardPresets | undefined,
  userWidgets: DashboardWidget[] = [],
): ResolvedWidget[] {
  const out: ResolvedWidget[] = [];

  for (const id of PRESET_ORDER) {
    const cfg = presets?.[id];
    if (cfg === false) { continue; }
    const opts = (cfg === undefined || cfg === true) ? {} : cfg;
    out.push(PRESET_BUILDERS[id](opts));
  }

  const seen = new Set<string>(out.map((w) => w.id));
  for (const w of userWidgets) {
    const id = w.id ?? slugify(w.title);
    if (!id) {
      throw new Error(
        `[admin] dashboard widget has no usable id — provide \`id\` or a non-empty \`title\` (got title=${JSON.stringify(w.title)})`,
      );
    }
    if (PRESET_IDS.has(id)) {
      throw new Error(
        `[admin] dashboard widget id "${id}" collides with a preset of the same name — configure the preset via \`dashboard.presets.${id}\` instead of \`dashboard.widgets\`, or pick a different id`,
      );
    }
    if (seen.has(id)) {
      throw new Error(`[admin] dashboard widget id "${id}" is used more than once`);
    }
    seen.add(id);
    const render: WidgetRender = w.render ?? 'json';
    out.push({
      id,
      title: w.title,
      icon: w.icon,
      render,
      span: w.span ?? DEFAULT_SPAN[render],
      refreshIntervalMs: w.refreshIntervalMs,
      data: w.data,
    });
  }

  return out;
}

/** Run one resolved widget. Errors are caught and surfaced as `{ error }`. */
export async function runWidget(
  w: ResolvedWidget,
  ctx: { database: GameDatabase; userId: string },
): Promise<DashboardWidgetEntry> {
  const base = {
    id: w.id,
    title: w.title,
    icon: w.icon,
    render: w.render,
    span: w.span,
    refreshIntervalMs: w.refreshIntervalMs,
  };
  try {
    const data = await w.data(ctx);
    return { ...base, data };
  } catch (err: any) {
    return { ...base, data: null, error: err?.message ?? String(err) };
  }
}

/** Build the JSON payload for GET /_dashboard. Errors per-widget surface as `{ error }`. */
export async function runWidgets(
  widgets: ResolvedWidget[],
  ctx: { database: GameDatabase; userId: string },
): Promise<DashboardPayload> {
  const results = await Promise.all(widgets.map((w) => runWidget(w, ctx)));
  return { widgets: results };
}

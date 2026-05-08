import path from 'path';
import { fileURLToPath } from 'url'; // required for ESM build (see build.mjs)
import { createEndpoint, type Endpoint } from '@colyseus/core';
import { sql, asc, desc, eq } from 'drizzle-orm';
import { getTableConfig as getPgTableConfig } from 'drizzle-orm/pg-core';
import { getTableConfig as getSqliteTableConfig } from 'drizzle-orm/sqlite-core';
import type { Action, GameDatabase } from '@colyseus/database';
import { serveStatic } from './static.js';
import { json, errorResponse } from './respond.js';
import { iconForTableName } from './default-icons.js';
import { humanize } from './humanize.js';
import type { ResourceDefinition } from './define-resource.js';
import { authEndpoints } from './auth.js';
import { readSessionFromHeader, type SessionConfig } from './sessions.js';
import { logger as defaultLogger, withRequestLogger, type Logger } from './logger.js';
import {
  resolveWidgets,
  runWidgets,
  dashboardWidgets,
  type DashboardWidget,
  type DashboardPayload,
  type BuiltInWidgetId,
} from './dashboard.js';

export { defineAdminResource } from './define-resource.js';
export type { ResourceDefinition, ResourceAction, PolicyEntry } from './define-resource.js';
export type { SessionConfig, AdminSession } from './sessions.js';
export type { DashboardWidget, DashboardPayload, BuiltInWidgetId } from './dashboard.js';
export { dashboardWidgets } from './dashboard.js';

export interface AdminOptions {
  /** GameDatabase instance — provides drizzle client + moderation. */
  database: GameDatabase;

  /**
   * Map of drizzle tables exposed by the admin, keyed by canonical name.
   * Spread in the GameDatabase tables plus any user-defined ones:
   *
   *   tables: { ...database.tables, guilds }
   *
   * Falls back to `database.tables` if omitted.
   */
  tables?: Record<string, any>;

  /** Per-resource UI/UX overrides keyed by drizzle table name. */
  resources?: Record<string, ResourceDefinition>;

  /** Mount path for admin UI. Default `/admin`. Canonical URL is `${uiPath}/`. */
  uiPath?: string;

  /** Mount path for REST API. Default `/admin-api`. */
  apiPath?: string;

  /** Absolute path to the built UI; defaults to ../build relative to this file. */
  uiDistDir?: string;

  /**
   * Override the default identity resolver. Default reads the session cookie
   * (HttpOnly JWT) and falls back to the X-User-Id header iff allowDevHeader
   * is true. Provide your own to integrate with another auth scheme.
   */
  resolveUserId?: (ctx: { getHeader: (k: string) => string | null }) => Promise<string | undefined> | string | undefined;

  /** Set to false to skip RBAC entirely (dev only). */
  enforceRbac?: boolean;

  /**
   * Permit `X-User-Id: <id>` as a fallback identity source. Defaults to true
   * in dev (NODE_ENV !== "production") so puppeteer/curl can auth without a
   * real session, and false in production. Set explicitly to override.
   */
  allowDevHeader?: boolean;

  /** Session/cookie config (TTL, domain, SameSite). See SessionConfig. */
  session?: SessionConfig;

  /**
   * Pino-compatible logger (or any object with .info/.warn/.error/.child).
   * Defaults to a JSON-stdout logger; pass `null` to silence; pass your own
   * to integrate with your existing logging stack.
   */
  logger?: Logger | null;

  /**
   * Dashboard customization for the admin home page.
   *
   * Built-in widgets — `totals`, `recentUsers`, `activeEvents`, `health` —
   * are auto-included by default and can be tuned three ways:
   *
   *   1. **Pick which to keep** with `builtIns`: e.g. `['health', 'recentUsers']`
   *      drops `totals` (often noisy in real games) and `activeEvents`. Pass
   *      `[]` to disable all built-ins and ship only your own widgets.
   *   2. **Override by id** in `widgets`: a widget with `id: 'recentUsers'`
   *      replaces the built-in's data fn while preserving order.
   *   3. **Append new ids** in `widgets`: any unrecognized id is added at
   *      the end — typical for game-specific KPIs.
   *
   * For composition, the built-ins are also exported as factory functions
   * via `dashboardWidgets.{totals,recentUsers,activeEvents,health}` — pass
   * one with custom options into your `widgets` array.
   *
   * @example
   *   import { dashboardWidgets } from '@colyseus/admin';
   *   dashboard: {
   *     builtIns: ['health'],            // keep only the health widget
   *     widgets: [
   *       dashboardWidgets.recentUsers({ limit: 10 }),  // re-add, customized
   *       { id: 'rooms', render: 'kpi', data: async () => ({ active: 5 }) },
   *     ],
   *   }
   */
  dashboard?: {
    /** Built-in widget ids to auto-include. Default: all four. */
    builtIns?: BuiltInWidgetId[];
    /** Custom widgets — override built-ins by id, or append new ones. */
    widgets?: DashboardWidget[];
  };
}

/**
 * Default resolver: try the session cookie first, fall back to X-User-Id only
 * when allowDevHeader is true. Cookie-based sessions are the production path;
 * the header is dev-only convenience for puppeteer/curl.
 */
function makeDefaultResolver(allowDevHeader: boolean) {
  return async function defaultResolve(ctx: { getHeader: (k: string) => string | null }): Promise<string | undefined> {
    const session = await readSessionFromHeader(ctx.getHeader('cookie'));
    if (session) { return session.userId; }
    if (allowDevHeader) {
      return ctx.getHeader('x-user-id') ?? undefined;
    }
    return undefined;
  };
}

/**
 * Returns an object of better-call endpoints for the admin panel — REST + static UI.
 * Spread into `createRouter({ ...adminEndpoints({ database }), yourRoutes... })`.
 */
export function adminEndpoints(opts: AdminOptions): Record<string, Endpoint> {
  const { database } = opts;
  const apiPath = (opts.apiPath ?? '/admin-api').replace(/\/$/, '');
  const uiPath = (opts.uiPath ?? '/admin').replace(/\/$/, '');
  // build.mjs's "dirname" plugin rewrites __dirname to a fileURLToPath call for the ESM build
  const uiDistDir = opts.uiDistDir ?? path.resolve(__dirname, '..', 'build');
  const allowDevHeader = opts.allowDevHeader ?? (process.env.NODE_ENV !== 'production');
  const resolveUserId = opts.resolveUserId ?? makeDefaultResolver(allowDevHeader);
  const enforceRbac = opts.enforceRbac !== false;
  const sessionConfig = opts.session ?? {};
  const logger = opts.logger === null ? null : (opts.logger ?? defaultLogger);

  const resolvedTables = opts.tables ?? database.tables;
  if (!resolvedTables) {
    throw new Error('[adminEndpoints] no tables provided — pass `tables` or call database.boot() first');
  }
  // Cast to a string-indexable map: GameDatabase types `tables` as a strict
  // mapped record (no string index signature) but the path-param lookup needs
  // a string key.
  const tables = resolvedTables as Record<string, any>;

  // Index resources by their underlying drizzle table name
  const resources = Object.fromEntries(
    Object.values(opts.resources ?? {}).map((r) => [r.__tableName, r]),
  ) as Record<string, ResourceDefinition>;

  // Reverse lookup: drizzle table → canonical key (used by tableOrError)
  const tableNameSymbol = Symbol.for('drizzle:Name');
  const drizzleNameToKey = new Map<string, string>();
  for (const [key, table] of Object.entries(tables)) {
    const drizzleName = (table as any)?.[tableNameSymbol];
    if (drizzleName) { drizzleNameToKey.set(drizzleName, key); }
  }

  /** Returns null if allowed; a Response (401/403) if denied. */
  async function guard(ctx: any, action: Action, resource: string): Promise<Response | null> {
    if (!enforceRbac) { return null; }
    const userId = await resolveUserId({ getHeader: ctx.getHeader });
    if (!userId) { return errorResponse(401, 'not authenticated — sign in at /admin/login'); }

    // Per-resource policy override takes precedence
    const policy = resources[resource]?.policies?.[action];
    if (policy !== undefined) {
      if (policy === 'deny') { return errorResponse(403, `forbidden: ${action} on ${resource}`); }
      if (policy === 'everyone') { return null; }
      const role = await database.moderation.getRole(userId);
      if (!policy.includes(role)) { return errorResponse(403, `forbidden: ${action} on ${resource}`); }
      return null;
    }

    const ok = await database.moderation.can(userId, action, resource);
    if (!ok) { return errorResponse(403, `forbidden: ${action} on ${resource}`); }
    return null;
  }

  function tableOrError(name: string): { table: any; cfg: any } | Response {
    const table = tables[name];
    if (!table) { return errorResponse(404, `unknown resource '${name}'`); }
    return { table, cfg: getTableConfig(table) };
  }

  // pg-core and sqlite-core expose getTableConfig with the same structural shape.
  // Pick once at setup based on the GameDatabase's dialect.
  const getTableConfig: (table: any) => any = (database as any).dialect === 'pg'
    ? (getPgTableConfig as any)
    : (getSqliteTableConfig as any);

  function castPk(raw: string, col: any): any {
    const t = (col as any).getSQLType?.();
    if (t === 'integer' || t === 'serial' || t === 'bigint') { return Number(raw); }
    return raw;
  }

  function listColumns(cfg: any, def: ResourceDefinition | undefined): string[] {
    if (def?.list?.columns) { return def.list.columns; }
    return cfg.columns.map((c: any) => c.name);
  }

  // Auth endpoints (login/logout/bootstrap/me/status). Spread alongside the
  // CRUD endpoints so consumers get one map to spread into createRouter.
  const auth = authEndpoints({ database, apiPath, session: sessionConfig });

  // GET /admin-api/_health — readiness probe. Verifies DB connectivity by
  // running a trivial SELECT against the live drizzle client. Suitable for
  // k8s readinessProbe / ALB target group health checks.
  const healthcheck = createEndpoint(`${apiPath}/_health`, { method: 'GET' }, async () => {
    const start = Date.now();
    try {
      // Cross-dialect connectivity check: SELECT 1 from any registered table.
      // .execute() is pg-only; .select().from().limit(0) works on both pg + sqlite.
      await database.drizzle
        .select({ one: sql<number>`1` })
        .from(database.tables.users)
        .limit(0);
      return json({ ok: true, db: 'ok', latencyMs: Date.now() - start });
    } catch (err: any) {
      logger?.error?.({ err: err?.message ?? String(err) }, 'healthcheck: db failure');
      return json(
        { ok: false, db: 'down', error: err?.message ?? String(err) },
        { status: 503 },
      );
    }
  });

  // Pre-resolve widget set once at setup. `dashboard.builtIns` selects which
  // defaults to include; `dashboard.widgets` overrides by id or appends.
  const widgets = resolveWidgets(opts.dashboard?.builtIns, opts.dashboard?.widgets);

  // GET /admin-api/_dashboard — runs every widget and returns JSON to render.
  // Reads through the same auth resolver as CRUD endpoints; anonymous users
  // see 401 and the SignInGate kicks them to /login.
  const dashboardEndpoint = createEndpoint(`${apiPath}/_dashboard`, { method: 'GET' }, async (ctx) => {
    const userId = await resolveUserId({ getHeader: ctx.getHeader });
    if (enforceRbac && !userId) {
      return errorResponse(401, 'not authenticated — sign in at /admin/login');
    }
    const payload = await runWidgets(widgets, { database, userId: userId ?? '' });
    return json(payload);
  });

  return {
    ...auth,
    adminHealthcheck: healthcheck,
    adminDashboard: dashboardEndpoint,

    // GET /admin-api → resource catalog
    adminResources: createEndpoint(apiPath, { method: 'GET' }, async () => {
      const result = Object.entries(tables).map(([name, t]) => {
        const cfg = getTableConfig(t);
        const def = resources[name];
        const compositePk = (cfg.primaryKeys ?? []).flatMap((pk: any) =>
          pk.columns.map((c: any) => c.name));
        const singlePk = cfg.columns.filter((c: any) => c.primary).map((c: any) => c.name);
        // Filter to only relations whose target is actually registered as a
        // resource — otherwise we'd point the UI at endpoints that 404.
        const sourceRelations = (database.relations[name] ?? [])
          .filter((r) => !!tables[r.target])
          .map((r) => ({ name: r.name, target: r.target, kind: r.kind }));
        return {
          name,
          label: def?.label ?? humanize(name),
          icon: def?.icon ?? iconForTableName(cfg.name),
          columns: cfg.columns.map((c: any) => ({
            name: c.name,
            type: typeof c.getSQLType === 'function' ? c.getSQLType() : 'text',
            notNull: c.notNull,
            primary: c.primary,
            hasDefault: !!c.hasDefault || !!c.defaultFn,
          })),
          primaryKey: singlePk.length ? singlePk : compositePk,
          listColumns: def?.list?.columns,
          formFields: def?.form?.fields,
          showFields: def?.show?.fields,
          actions: (def?.actions ?? []).map((a) => ({
            name: a.name,
            label: a.label ?? a.name,
            perRow: !!a.perRow,
          })),
          relations: sourceRelations,
        };
      });
      return json(result);
    }),

    // GET /admin-api/:resource/:id/relations/:name
    //   → paginated list of related rows. The relation's `fk` column on the
    //     target table is matched against this row's primary key value.
    adminRelation: createEndpoint(
      `${apiPath}/:resource/:id/relations/:name`,
      { method: 'GET' },
      async (ctx) => {
        const { resource, id, name } = ctx.params as { resource: string; id: string; name: string };
        const denied = await guard(ctx, 'list', resource);
        if (denied) { return denied; }

        const rel = (database.relations[resource] ?? []).find((r) => r.name === name);
        if (!rel) { return errorResponse(404, `unknown relation '${name}' on '${resource}'`); }

        const targetTable = tables[rel.target];
        if (!targetTable) { return errorResponse(404, `relation '${name}' targets unknown resource '${rel.target}'`); }

        // RBAC on the *target* — viewing a parent's items respects items' policies.
        const targetDenied = await guard(ctx, 'list', rel.target);
        if (targetDenied) { return targetDenied; }

        // RelationDefinition.fk is the drizzle JS field name (e.g. 'userId'),
        // matching the property on the table object — not the SQL column
        // name. Direct property access gives us the typed Column for `eq()`.
        const fkCol = (targetTable as any)[rel.fk];
        if (!fkCol) {
          return errorResponse(500, `relation '${name}' fk '${rel.fk}' not found on '${rel.target}'`);
        }

        // Cast the parent id to the source table's PK type. We use the source
        // resource's PK column to figure out the target type.
        const sourceCfg = getTableConfig(tables[resource]);
        const pkCol = sourceCfg.columns.find((c: any) => c.primary);
        const castId = pkCol ? castPk(id, pkCol) : id;

        const q = ctx.query ?? {};
        const start = parseInt(q._start as string) || 0;
        const end = parseInt(q._end as string) || start + 100;

        const rowsQuery = database.drizzle
          .select()
          .from(targetTable)
          .where(eq(fkCol, castId))
          .limit(end - start)
          .offset(start);
        const rows = await rowsQuery;
        const totalRows = await database.drizzle
          .select({ c: sql<number>`count(*)` })
          .from(targetTable)
          .where(eq(fkCol, castId));
        const total = Number(totalRows[0]?.c ?? 0);

        return json(rows, {
          headers: {
            'x-total-count': String(total),
            'access-control-expose-headers': 'x-total-count',
          },
        });
      },
    ),

    // POST /admin-api/:resource/_action/:action → run a custom action
    adminAction: createEndpoint(`${apiPath}/:resource/_action/:action`, { method: 'POST' }, async (ctx) => {
      const { resource, action: actionName } = ctx.params as { resource: string; action: string };
      const def = resources[resource];
      const found = def?.actions?.find((a) => a.name === actionName);
      if (!found) { return errorResponse(404, `unknown action '${actionName}' on '${resource}'`); }

      const userId = await resolveUserId({ getHeader: ctx.getHeader });
      if (enforceRbac) {
        if (!userId) { return errorResponse(401, 'not authenticated — sign in at /admin/login'); }
        if (found.roles && found.roles.length > 0) {
          const role = await database.moderation.getRole(userId);
          if (!found.roles.includes(role)) {
            return errorResponse(403, `forbidden: action '${actionName}' on '${resource}'`);
          }
        }
      }

      let row: any = null;
      const body = (ctx.body ?? {}) as { id?: string };
      if (found.perRow) {
        if (!body.id) { return errorResponse(400, `action '${actionName}' requires an id`); }
        const r = tableOrError(resource);
        if (r instanceof Response) { return r; }
        const pkCol = r.cfg.columns.find((c: any) => c.primary);
        if (!pkCol) { return errorResponse(400, 'no single-column primary key for per-row action'); }
        const rows = await database.drizzle.select().from(r.table).where(eq(pkCol, castPk(body.id, pkCol))).limit(1);
        if (!rows[0]) { return errorResponse(404, 'row not found'); }
        row = rows[0];
      }

      const result = await found.handler(row, { userId: userId ?? '', resource });
      return json({ ok: true, result: result ?? null });
    }),

    // GET /admin-api/:resource → list with refine simple-rest pagination/sort
    adminList: createEndpoint(`${apiPath}/:resource`, { method: 'GET' }, async (ctx) => {
      const { resource } = ctx.params as { resource: string };
      const denied = await guard(ctx, 'list', resource);
      if (denied) { return denied; }
      const r = tableOrError(resource);
      if (r instanceof Response) { return r; }
      const { table, cfg } = r;
      const def = resources[resource];

      const q = ctx.query ?? {};
      const start = parseInt(q._start as string) || 0;
      const end = parseInt(q._end as string) || start + 100;
      const sortField = q._sort as string | undefined;
      const sortOrder = (q._order as string)?.toUpperCase() === 'DESC' ? 'desc' : 'asc';

      const visibleCols = listColumns(cfg, def);
      const projection: Record<string, any> = {};
      for (const colName of visibleCols) {
        const col = cfg.columns.find((c: any) => c.name === colName);
        if (col) { projection[colName] = col; }
      }
      // Always include primary key cols so the UI can identify rows
      for (const col of cfg.columns) {
        if (col.primary && !(col.name in projection)) { projection[col.name] = col; }
      }

      let query = database.drizzle.select(projection).from(table).limit(end - start).offset(start) as any;
      if (sortField) {
        const col = cfg.columns.find((c: any) => c.name === sortField);
        if (col) { query = query.orderBy(sortOrder === 'desc' ? desc(col) : asc(col)); }
      }

      const rows = await query;
      const totalRows = await database.drizzle.select({ c: sql<number>`count(*)` }).from(table);
      const total = Number(totalRows[0]?.c ?? 0);

      return json(rows, { headers: {
        'x-total-count': String(total),
        'access-control-expose-headers': 'x-total-count',
      }});
    }),

    // GET /admin-api/:resource/:id
    adminGet: createEndpoint(`${apiPath}/:resource/:id`, { method: 'GET' }, async (ctx) => {
      const { resource, id } = ctx.params as { resource: string; id: string };
      const denied = await guard(ctx, 'read', resource);
      if (denied) { return denied; }
      const r = tableOrError(resource);
      if (r instanceof Response) { return r; }
      const { table, cfg } = r;
      const pkCol = cfg.columns.find((c: any) => c.primary);
      if (!pkCol) { return errorResponse(400, 'no single-column primary key'); }
      const rows = await database.drizzle.select().from(table).where(eq(pkCol, castPk(id, pkCol))).limit(1);
      if (!rows[0]) { return errorResponse(404, 'not found'); }
      return json(rows[0]);
    }),

    // POST /admin-api/:resource
    adminCreate: createEndpoint(`${apiPath}/:resource`, { method: 'POST' }, async (ctx) => {
      const { resource } = ctx.params as { resource: string };
      const denied = await guard(ctx, 'create', resource);
      if (denied) { return denied; }
      const r = tableOrError(resource);
      if (r instanceof Response) { return r; }
      const [row] = await database.drizzle.insert(r.table).values((ctx.body ?? {}) as any).returning();
      return json(row, { status: 201 });
    }),

    // PUT /admin-api/:resource/:id
    adminUpdate: createEndpoint(`${apiPath}/:resource/:id`, { method: 'PUT' }, async (ctx) => {
      const { resource, id } = ctx.params as { resource: string; id: string };
      const denied = await guard(ctx, 'update', resource);
      if (denied) { return denied; }
      const r = tableOrError(resource);
      if (r instanceof Response) { return r; }
      const { table, cfg } = r;
      const pkCol = cfg.columns.find((c: any) => c.primary);
      if (!pkCol) { return errorResponse(400, 'no single-column primary key'); }
      const [row] = await database.drizzle.update(table).set((ctx.body ?? {}) as any)
        .where(eq(pkCol, castPk(id, pkCol))).returning();
      if (!row) { return errorResponse(404, 'not found'); }
      return json(row);
    }),

    // DELETE /admin-api/:resource/:id
    adminDelete: createEndpoint(`${apiPath}/:resource/:id`, { method: 'DELETE' }, async (ctx) => {
      const { resource, id } = ctx.params as { resource: string; id: string };
      const denied = await guard(ctx, 'delete', resource);
      if (denied) { return denied; }
      const r = tableOrError(resource);
      if (r instanceof Response) { return r; }
      const { table, cfg } = r;
      const pkCol = cfg.columns.find((c: any) => c.primary);
      if (!pkCol) { return errorResponse(400, 'no single-column primary key'); }
      const [row] = await database.drizzle.delete(table).where(eq(pkCol, castPk(id, pkCol))).returning();
      if (!row) { return errorResponse(404, 'not found'); }
      return json(row);
    }),

    // GET /admin/ → serve index.html (canonical URL)
    adminUiIndex: createEndpoint(`${uiPath}/`, { method: 'GET' }, async () => {
      return serveStatic(uiDistDir, '');
    }),

    // GET /admin/**:splat → static assets (with SPA fallback to index.html)
    adminUiAssets: createEndpoint(`${uiPath}/**:splat`, { method: 'GET' }, async (ctx) => {
      const splat = (ctx.params as any).splat as string | undefined;
      return serveStatic(uiDistDir, splat);
    }),
  } as Record<string, Endpoint>;
}

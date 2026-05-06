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

export { defineAdminResource } from './define-resource.js';
export type { ResourceDefinition, ResourceAction, PolicyEntry } from './define-resource.js';

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

  /** How to identify the requesting user — defaults to X-User-Id header. */
  resolveUserId?: (ctx: { getHeader: (k: string) => string | null }) => string | undefined;

  /** Set to false to skip RBAC entirely (dev only). */
  enforceRbac?: boolean;
}

function defaultResolve(ctx: { getHeader: (k: string) => string | null }): string | undefined {
  return ctx.getHeader('x-user-id') ?? undefined;
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
  const resolveUserId = opts.resolveUserId ?? defaultResolve;
  const enforceRbac = opts.enforceRbac !== false;

  // Resolve tables. Default to GameDatabase's resolved schemas.
  const tables = opts.tables ?? database.tables;
  if (!tables) {
    throw new Error('[adminEndpoints] no tables provided — pass `tables` or call database.boot() first');
  }

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
    const userId = resolveUserId({ getHeader: ctx.getHeader });
    if (!userId) { return errorResponse(401, 'missing user id (X-User-Id header)'); }

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

  return {
    // GET /admin-api → resource catalog
    adminResources: createEndpoint(apiPath, { method: 'GET' }, async () => {
      const result = Object.entries(tables).map(([name, t]) => {
        const cfg = getTableConfig(t);
        const def = resources[name];
        const compositePk = (cfg.primaryKeys ?? []).flatMap((pk: any) =>
          pk.columns.map((c: any) => c.name));
        const singlePk = cfg.columns.filter((c: any) => c.primary).map((c: any) => c.name);
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
        };
      });
      return json(result);
    }),

    // POST /admin-api/:resource/_action/:action → run a custom action
    adminAction: createEndpoint(`${apiPath}/:resource/_action/:action`, { method: 'POST' }, async (ctx) => {
      const { resource, action: actionName } = ctx.params as { resource: string; action: string };
      const def = resources[resource];
      const found = def?.actions?.find((a) => a.name === actionName);
      if (!found) { return errorResponse(404, `unknown action '${actionName}' on '${resource}'`); }

      const userId = resolveUserId({ getHeader: ctx.getHeader });
      if (enforceRbac) {
        if (!userId) { return errorResponse(401, 'missing user id (X-User-Id header)'); }
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

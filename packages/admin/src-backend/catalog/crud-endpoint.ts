/**
 * The five standard CRUD endpoints for any registered resource:
 *
 *   GET    /admin-api/:resource           — paginated list (search + filter + sort)
 *   GET    /admin-api/:resource/:id       — single row by PK
 *   POST   /admin-api/:resource           — create
 *   PUT    /admin-api/:resource/:id       — replace via runUpdate
 *   PATCH  /admin-api/:resource/:id       — partial update via runUpdate
 *   DELETE /admin-api/:resource/:id       — delete + audit-log
 *
 * @refinedev/simple-rest sends PATCH for `update` by default; accepting
 * PUT keeps custom clients working. They share the `runUpdate` handler.
 *
 * Every mutation is audit-logged via `tryAudit` so a logger failure can't
 * break the user's request.
 */
import { createEndpoint, type Endpoint } from '@colyseus/core';
import { and, asc, desc, like, or, sql, type SQL } from 'drizzle-orm';
import {
  buildFilterCondition,
  listColumns,
  pkColumns,
  sqlKeyedProjection,
  translateBodyKeys,
  tryAudit,
} from '../internal/helpers.js';
import { errorResponse, json } from '../internal/http.js';
import { guard, pkOrError, tableOrError, type EndpointContext } from '../internal/context.js';

const RESERVED_QUERY_KEYS = new Set(['_start', '_end', '_sort', '_order', '_q']);

// ---------------------------------------------------------------------------
// GET /admin-api/:resource — list with refine simple-rest semantics:
//   _start / _end          → pagination
//   _sort / _order         → sort
//   _q                     → free-text search across text columns
//   <col>[_op]=value       → per-column filters (eq/ne/like/gt/gte/lt/lte)
// PK columns are always included so the UI can identify rows for /show / /edit.
// ---------------------------------------------------------------------------

export function listEndpoint(ctx: EndpointContext): Endpoint {
  return createEndpoint(`${ctx.apiPath}/:resource`, { method: 'GET' }, async (reqCtx) => {
    const { resource } = reqCtx.params as { resource: string };
    const denied = await guard(ctx, reqCtx, 'list', resource);
    if (denied) { return denied; }
    const r = tableOrError(ctx, resource);
    if (r instanceof Response) { return r; }
    const { table, cfg } = r;
    const def = ctx.resources[resource];

    const q = reqCtx.query ?? {};
    const start = parseInt(q._start as string) || 0;
    const end = parseInt(q._end as string) || start + 100;
    const sortField = q._sort as string | undefined;
    const sortOrder = (q._order as string)?.toUpperCase() === 'DESC' ? 'desc' : 'asc';
    // Free-text search across text columns. ILIKE-style on pg, LIKE on
    // sqlite (LIKE is already case-insensitive for ASCII in sqlite default).
    const search = typeof q._q === 'string' ? q._q.trim() : '';

    const visibleCols = listColumns(cfg, def);
    const projection: Record<string, any> = {};
    for (const colName of visibleCols) {
      const col = cfg.columns.find((c) => c.name === colName);
      if (col) { projection[colName] = col; }
    }
    // Always include primary key cols so the UI can identify rows
    for (const col of cfg.columns) {
      if (col.primary && !(col.name in projection)) { projection[col.name] = col; }
    }

    // Build the WHERE clause from (1) free-text `_q` search and (2)
    // per-column filters sent as `?<col>[_op]=<value>`.
    const conditions: SQL[] = [];

    if (search.length > 0) {
      const pattern = `%${search}%`;
      const textCols = cfg.columns.filter((c) => {
        const t = typeof c.getSQLType === 'function' ? c.getSQLType() : '';
        return /^(text|varchar|char)/i.test(t);
      });
      const orConds = textCols.map((c) => like(c as any, pattern));
      if (orConds.length > 0) {
        const oredOpt = or(...orConds);
        if (oredOpt) { conditions.push(oredOpt); }
      }
    }

    // Per-column filters. Refine simple-rest serializes filters as
    // `field=value` (eq), `field_like=value`, `field_gte=value`, etc.
    // We accept eq/ne/like/gt/gte/lt/lte; everything else is ignored.
    for (const [key, raw] of Object.entries(q)) {
      if (RESERVED_QUERY_KEYS.has(key)) { continue; }
      if (typeof raw !== 'string' || raw.length === 0) { continue; }
      const match = key.match(/^(.+?)_(like|in|eq|ne|gt|gte|lt|lte)$/);
      const fieldName = match ? match[1]! : key;
      const op = match ? match[2]! : 'eq';
      const col = cfg.columns.find((c) => c.name === fieldName);
      if (!col) { continue; }
      const cond = buildFilterCondition(col, op, raw);
      if (cond) { conditions.push(cond); }
    }

    const whereClause: SQL | undefined =
      conditions.length === 0 ? undefined :
      conditions.length === 1 ? conditions[0]! :
      and(...conditions);

    let query = ctx.database.drizzle.select(projection).from(table).limit(end - start).offset(start) as any;
    if (whereClause) { query = query.where(whereClause); }
    // Apply explicit _sort first; fall back to the resource's
    // configured `defaultSort` so insertion-order-arbitrary tables
    // (audit log etc.) come out in a meaningful order even on the
    // first page load. Only one wins — explicit user input takes
    // precedence over the default.
    const effectiveSort: { field: string; order: 'asc' | 'desc' } | null =
      sortField ? { field: sortField, order: sortOrder } :
      def?.list?.defaultSort ? def.list.defaultSort :
      null;
    if (effectiveSort) {
      const col = cfg.columns.find((c) => c.name === effectiveSort.field);
      if (col) { query = query.orderBy(effectiveSort.order === 'desc' ? desc(col as any) : asc(col as any)); }
    }

    const rows = await query;
    let countQuery = ctx.database.drizzle.select({ c: sql<number>`count(*)` }).from(table) as any;
    if (whereClause) { countQuery = countQuery.where(whereClause); }
    const totalRows = await countQuery;
    const total = Number(totalRows[0]?.c ?? 0);

    return json(rows, { headers: {
      'x-total-count': String(total),
      'access-control-expose-headers': 'x-total-count',
    }});
  });
}

// ---------------------------------------------------------------------------
// GET /admin-api/:resource/:id — fetch a single row by PK.
// ---------------------------------------------------------------------------

export function getEndpoint(ctx: EndpointContext): Endpoint {
  return createEndpoint(`${ctx.apiPath}/:resource/:id`, { method: 'GET' }, async (reqCtx) => {
    const { resource, id } = reqCtx.params as { resource: string; id: string };
    const denied = await guard(ctx, reqCtx, 'read', resource);
    if (denied) { return denied; }
    const r = tableOrError(ctx, resource);
    if (r instanceof Response) { return r; }
    const { table, cfg } = r;
    const built = pkOrError(cfg, id);
    if (built instanceof Response) { return built; }
    const rows = await ctx.database.drizzle
      .select(sqlKeyedProjection(cfg))
      .from(table)
      .where(built.where)
      .limit(1);
    if (!rows[0]) { return errorResponse(404, 'not found'); }
    return json(rows[0]);
  });
}

// ---------------------------------------------------------------------------
// POST /admin-api/:resource — insert a new row. Body keys are SQL column
// names (what the form binds to); we translate to drizzle's JS field names
// + coerce types (date strings → Date, etc.) before insert.
// ---------------------------------------------------------------------------

export function createEndpoint_(ctx: EndpointContext): Endpoint {
  return createEndpoint(`${ctx.apiPath}/:resource`, { method: 'POST' }, async (reqCtx) => {
    const { resource } = reqCtx.params as { resource: string };
    const denied = await guard(ctx, reqCtx, 'create', resource);
    if (denied) { return denied; }
    const r = tableOrError(ctx, resource);
    if (r instanceof Response) { return r; }

    // Resolve the operator once — used for both `create.defaults(...)` and
    // the audit record. Resolving before the insert means default factories
    // and the audit see the same identity for this request.
    const operatorId = await ctx.resolveUserId({ getHeader: reqCtx.getHeader });

    // Server-side defaults from the resource definition (e.g. autofill
    // `authorId` from the signed-in admin). Merged BEFORE the body so the
    // body wins — defaults only fill keys the request didn't set.
    const definition = ctx.resources[resource];
    const defaults = definition?.create?.defaults
      ? await definition.create.defaults({ operatorId, resource })
      : undefined;
    const body = (reqCtx.body ?? {}) as Record<string, any>;
    const merged = defaults
      ? { ...translateBodyKeys(defaults, r.table), ...translateBodyKeys(body, r.table) }
      : translateBodyKeys(body, r.table);

    const [row] = await ctx.database.drizzle
      .insert(r.table)
      .values(merged)
      .returning(sqlKeyedProjection(r.cfg));

    // Audit: capture the created row + the operator behind the creation.
    const targetId = (() => {
      const pkCols = pkColumns(r.cfg);
      if (pkCols.length === 1) { return String(row[pkCols[0]!.name]); }
      return null;
    })();
    await tryAudit(ctx.logger, () => ctx.database.audit.record({
      operatorId, action: 'create', resource, targetId, payload: { row },
    }));
    return json(row, { status: 201 });
  });
}

// ---------------------------------------------------------------------------
// PUT/PATCH /admin-api/:resource/:id — partial update. Audit entry records
// a column-level diff via AuditService.recordUpdate so non-admin code (cron,
// scripts) gets the same `{ changes: { col: { before, after } } }` shape.
// ---------------------------------------------------------------------------

export function updateEndpoint(ctx: EndpointContext, method: 'PUT' | 'PATCH'): Endpoint {
  return createEndpoint(`${ctx.apiPath}/:resource/:id`, { method }, async (reqCtx) => {
    const { resource, id } = reqCtx.params as { resource: string; id: string };
    const denied = await guard(ctx, reqCtx, 'update', resource);
    if (denied) { return denied; }
    const r = tableOrError(ctx, resource);
    if (r instanceof Response) { return r; }
    const { table, cfg } = r;
    const built = pkOrError(cfg, id);
    if (built instanceof Response) { return built; }
    // Snapshot before-state so the audit entry has a {before, after} diff
    // rather than just the post-update row.
    const beforeRows = await ctx.database.drizzle
      .select(sqlKeyedProjection(cfg))
      .from(table)
      .where(built.where)
      .limit(1);
    const set = translateBodyKeys((reqCtx.body ?? {}) as Record<string, any>, table);
    const [row] = await ctx.database.drizzle.update(table).set(set)
      .where(built.where).returning(sqlKeyedProjection(cfg));
    if (!row) { return errorResponse(404, 'not found'); }
    const operatorId = await ctx.resolveUserId({ getHeader: reqCtx.getHeader });
    await tryAudit(ctx.logger, () => ctx.database.audit.recordUpdate({
      operatorId, resource, targetId: id,
      before: beforeRows[0] as any, after: row,
    }));
    return json(row);
  });
}

// ---------------------------------------------------------------------------
// DELETE /admin-api/:resource/:id — drop a row by PK + audit-log it.
// ---------------------------------------------------------------------------

export function deleteEndpoint(ctx: EndpointContext): Endpoint {
  return createEndpoint(`${ctx.apiPath}/:resource/:id`, { method: 'DELETE' }, async (reqCtx) => {
    const { resource, id } = reqCtx.params as { resource: string; id: string };
    const denied = await guard(ctx, reqCtx, 'delete', resource);
    if (denied) { return denied; }
    const r = tableOrError(ctx, resource);
    if (r instanceof Response) { return r; }
    const { table, cfg } = r;
    const built = pkOrError(cfg, id);
    if (built instanceof Response) { return built; }
    const [row] = await ctx.database.drizzle.delete(table).where(built.where)
      .returning(sqlKeyedProjection(cfg));
    if (!row) { return errorResponse(404, 'not found'); }
    const operatorId = await ctx.resolveUserId({ getHeader: reqCtx.getHeader });
    await tryAudit(ctx.logger, () => ctx.database.audit.record({
      operatorId, action: 'delete', resource, targetId: id, payload: { row },
    }));
    return json(row);
  });
}

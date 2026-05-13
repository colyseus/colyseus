/**
 * Shared state every admin endpoint needs. Built once in `adminEndpoints()`
 * and threaded through each endpoint factory so the endpoint files stay
 * pure functions of `(ctx) => Endpoint` — easy to read, easy to test.
 *
 * The `tableOrError`, `pkOrError`, and `guard` helpers live here because
 * they all close over the same fields and are used by 3+ endpoints. Pure
 * helpers that don't need the context (coerce, projection, body-translate,
 * filters, audit-helpers) stay in their own modules at the top of
 * `src-backend/`.
 */
import type { GameDatabase, Action } from '@colyseus/database';
import { type SQL } from 'drizzle-orm';
import type { ResourceDefinition } from '../define-resource.js';
import type { Logger } from '../logger.js';
import { errorResponse } from '../http.js';
import { buildPkWhere, type TableConfig } from '../helpers.js';
import { clearSessionCookie, readSessionFromHeader } from '../sessions.js';

export interface EndpointContext {
  apiPath: string;
  uiPath: string;
  uiDistDir: string;
  database: GameDatabase;
  /** Index of drizzle tables keyed by canonical name. */
  tables: Record<string, any>;
  /** ResourceDefinition overrides keyed by drizzle table name. */
  resources: Record<string, ResourceDefinition>;
  /** Dialect-aware getTableConfig (sqlite-core or pg-core). */
  getTableConfig: (table: any) => TableConfig;
  /** Identity resolver — reads session cookie or X-User-Id header. */
  resolveUserId: (ctx: { getHeader: (k: string) => string | null }) => Promise<string | undefined> | string | undefined;
  /** When false, every endpoint skips RBAC entirely (dev only). */
  enforceRbac: boolean;
  /** Pino-compatible logger (or null when silenced). */
  logger: Logger | null;
}

/**
 * RBAC gate. Returns `null` when the request is allowed; a `Response` (401
 * or 403) when it should be rejected. Used by every CRUD endpoint as the
 * first thing they do.
 */
export async function guard(
  ctx: EndpointContext,
  reqCtx: any,
  action: Action,
  resource: string,
): Promise<Response | null> {
  if (!ctx.enforceRbac) { return null; }
  const userId = await ctx.resolveUserId({ getHeader: reqCtx.getHeader });
  if (!userId) { return errorResponse(401, 'not authenticated — sign in at /admin/login'); }

  // Per-resource policy override takes precedence
  const policy = ctx.resources[resource]?.policies?.[action];
  if (policy !== undefined) {
    if (policy === 'deny') { return errorResponse(403, `forbidden: ${action} on ${resource}`); }
    if (policy === 'everyone') { return null; }
    const role = await ctx.database.moderation.getRole(userId);
    if (!policy.includes(role)) { return errorResponse(403, `forbidden: ${action} on ${resource}`); }
    return null;
  }

  const ok = await ctx.database.moderation.can(userId, action, resource);
  if (!ok) {
    // Stale-cookie self-heal: cookie says admin, live DB disagrees
    // (roles row wiped or demoted). Clear the cookie and tag the
    // 403 so the frontend can route them back to /login.
    const session = await readSessionFromHeader(reqCtx.getHeader('cookie'));
    if (session?.role === 'admin') {
      ctx.logger?.warn?.(
        { userId, action, resource, cachedRole: session.role },
        '[admin] role mismatch — cookie says admin, live DB disagrees; clearing session',
      );
      return errorResponse(
        403,
        'role_mismatch: your session is stale (DB role no longer admin). Please sign in again.',
        { 'set-cookie': clearSessionCookie() },
      );
    }
    return errorResponse(403, `forbidden: ${action} on ${resource}`);
  }
  return null;
}

/** Look up a table + cfg by canonical name, or return a 404 Response. */
export function tableOrError(
  ctx: EndpointContext,
  name: string,
): { table: any; cfg: TableConfig } | Response {
  const table = ctx.tables[name];
  if (!table) { return errorResponse(404, `unknown resource '${name}'`); }
  return { table, cfg: ctx.getTableConfig(table) };
}

/**
 * Map a `buildPkWhere` failure into an HTTP error Response. The decode
 * logic is in helpers.ts and tested standalone; this is the response-shaping
 * adapter.
 */
export function pkOrError(cfg: TableConfig, id: string): { where: SQL } | Response {
  const built = buildPkWhere(cfg, id);
  if (!built.ok) { return errorResponse(built.status, built.message); }
  return { where: built.where };
}

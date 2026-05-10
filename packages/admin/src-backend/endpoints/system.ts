/**
 * System / infrastructure endpoints — non-CRUD, non-domain. Three of them:
 *
 *   GET /admin-api/_health       — readiness probe (verifies DB connectivity)
 *   GET /admin-api/_dashboard    — runs widget set + returns JSON to render
 *   GET /admin/                  — serves index.html (canonical UI URL)
 *   GET /admin/**:splat          — static SPA assets w/ index.html fallback
 *
 * Suitable for k8s readinessProbe / ALB target group health checks
 * (`_health` returns 503 when the DB is unreachable). The dashboard
 * widget machinery itself lives in `../dashboard.ts`.
 */
import { createEndpoint, type Endpoint } from '@colyseus/core';
import { sql } from 'drizzle-orm';
import {
  resolveWidgets, runWidgets,
  type BuiltInWidgetId, type DashboardWidget,
} from '../dashboard.js';
import { errorResponse, json, serveStatic } from '../http.js';
import type { EndpointContext } from './context.js';

export interface DashboardOptions {
  builtIns?: BuiltInWidgetId[];
  widgets?: DashboardWidget[];
}

// ---------------------------------------------------------------------------
// GET /admin-api/_health — readiness probe.
// .execute() is pg-only; .select().from().limit(0) works on both pg + sqlite.
// ---------------------------------------------------------------------------

export function healthEndpoint(ctx: EndpointContext): Endpoint {
  return createEndpoint(`${ctx.apiPath}/_health`, { method: 'GET' }, async () => {
    const start = Date.now();
    try {
      await ctx.database.drizzle
        .select({ one: sql<number>`1` })
        .from(ctx.database.tables.users)
        .limit(0);
      return json({ ok: true, db: 'ok', latencyMs: Date.now() - start });
    } catch (err: any) {
      ctx.logger?.error?.({ err: err?.message ?? String(err) }, 'healthcheck: db failure');
      return json(
        { ok: false, db: 'down', error: err?.message ?? String(err) },
        { status: 503 },
      );
    }
  });
}

// ---------------------------------------------------------------------------
// GET /admin-api/_dashboard — same auth path as CRUD; SignInGate kicks
// anonymous users to /login. Widget set is pre-resolved at setup time so
// the request handler is just RBAC + run-and-serialize.
// ---------------------------------------------------------------------------

export function dashboardEndpoint(
  ctx: EndpointContext,
  opts?: DashboardOptions,
): Endpoint {
  const widgets = resolveWidgets(opts?.builtIns, opts?.widgets);

  return createEndpoint(`${ctx.apiPath}/_dashboard`, { method: 'GET' }, async (reqCtx) => {
    const userId = await ctx.resolveUserId({ getHeader: reqCtx.getHeader });
    if (ctx.enforceRbac && !userId) {
      return errorResponse(401, 'not authenticated — sign in at /admin/login');
    }
    const payload = await runWidgets(widgets, { database: ctx.database, userId: userId ?? '' });
    return json(payload);
  });
}

// ---------------------------------------------------------------------------
// GET /admin/  + GET /admin/**:splat — serve the built admin SPA.
// ---------------------------------------------------------------------------

export function uiIndexEndpoint(ctx: EndpointContext): Endpoint {
  return createEndpoint(`${ctx.uiPath}/`, { method: 'GET' }, async () => {
    return serveStatic(ctx.uiDistDir, '');
  });
}

export function uiAssetsEndpoint(ctx: EndpointContext): Endpoint {
  return createEndpoint(`${ctx.uiPath}/**:splat`, { method: 'GET' }, async (reqCtx) => {
    const splat = (reqCtx.params as any).splat as string | undefined;
    return serveStatic(ctx.uiDistDir, splat);
  });
}

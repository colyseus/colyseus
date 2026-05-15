/**
 * Infrastructure endpoints — non-domain, non-CRUD.
 *
 *   GET /admin-api/_health  — readiness probe (verifies DB connectivity)
 *   GET /admin/             — serves index.html (canonical UI URL)
 *   GET /admin/**:splat     — static SPA assets w/ index.html fallback
 *
 * Suitable for k8s readinessProbe / ALB target group health checks
 * (`_health` returns 503 when the DB is unreachable).
 */
import { createEndpoint, type Endpoint } from '@colyseus/core';
import { sql } from 'drizzle-orm';
import { json, serveStatic } from '../internal/http.js';
import type { EndpointContext } from '../internal/context.js';

/**
 * GET /admin-api/_health — readiness probe.
 * `.execute()` is pg-only; `.select().from().limit(0)` works on both pg + sqlite.
 */
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

/** GET /admin/ — serve the canonical SPA index. */
export function uiIndexEndpoint(ctx: EndpointContext): Endpoint {
  return createEndpoint(`${ctx.uiPath}/`, { method: 'GET' }, async () => {
    return serveStatic(ctx.uiDistDir, '');
  });
}

/** GET /admin/**:splat — serve static SPA assets w/ index.html fallback. */
export function uiAssetsEndpoint(ctx: EndpointContext): Endpoint {
  return createEndpoint(`${ctx.uiPath}/**:splat`, { method: 'GET' }, async (reqCtx) => {
    const splat = (reqCtx.params as any).splat as string | undefined;
    return serveStatic(ctx.uiDistDir, splat);
  });
}

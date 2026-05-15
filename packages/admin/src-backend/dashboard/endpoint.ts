/**
 * Dashboard HTTP endpoints.
 *
 *   GET /admin-api/_dashboard             — full payload (all widgets)
 *   GET /admin-api/_dashboard/:widgetId   — single widget refresh
 *
 * The widget set is resolved ONCE per process (see `resolveDashboardWidgets`)
 * and shared between both endpoints so they always dispatch from the same
 * config.
 */
import { createEndpoint, type Endpoint } from '@colyseus/core';
import {
  resolveWidgets, runWidget, runWidgets,
  type DashboardPresets, type DashboardWidget, type ResolvedWidget,
} from './widgets.js';
import { errorResponse, json } from '../internal/http.js';
import type { EndpointContext } from '../internal/context.js';

export interface DashboardOptions {
  presets?: DashboardPresets;
  widgets?: DashboardWidget[];
}

/**
 * Resolve the widget set once at setup time. Shared between the full
 * dashboard endpoint and the per-widget refresh endpoint so both render
 * from the same config.
 */
export function resolveDashboardWidgets(opts?: DashboardOptions): ResolvedWidget[] {
  return resolveWidgets(opts?.presets, opts?.widgets);
}

/**
 * GET /admin-api/_dashboard — same auth path as CRUD; SignInGate kicks
 * anonymous users to /login. The widget set is pre-resolved at setup
 * time, so the request handler is just RBAC + run-and-serialize.
 */
export function dashboardEndpoint(
  ctx: EndpointContext,
  widgets: ResolvedWidget[],
): Endpoint {
  return createEndpoint(`${ctx.apiPath}/_dashboard`, { method: 'GET' }, async (reqCtx) => {
    const userId = await ctx.resolveUserId({ getHeader: reqCtx.getHeader });
    if (ctx.enforceRbac && !userId) {
      return errorResponse(401, 'not authenticated — sign in at /admin/login');
    }
    const payload = await runWidgets(widgets, { database: ctx.database, userId: userId ?? '' });
    return json(payload);
  });
}

/**
 * Single-widget refresh endpoint. Clients poll this for widgets that
 * declare `refreshIntervalMs` so an active dashboard stays current
 * without re-running every widget's data fn.
 */
export function dashboardWidgetEndpoint(
  ctx: EndpointContext,
  widgets: ResolvedWidget[],
): Endpoint {
  const byId = new Map(widgets.map((w) => [w.id, w]));
  return createEndpoint(
    `${ctx.apiPath}/_dashboard/:widgetId`,
    { method: 'GET' },
    async (reqCtx) => {
      const userId = await ctx.resolveUserId({ getHeader: reqCtx.getHeader });
      if (ctx.enforceRbac && !userId) {
        return errorResponse(401, 'not authenticated — sign in at /admin/login');
      }
      const id = (reqCtx.params as { widgetId: string }).widgetId;
      const widget = byId.get(id);
      if (!widget) {
        return errorResponse(404, `unknown dashboard widget: ${id}`);
      }
      const entry = await runWidget(widget, { database: ctx.database, userId: userId ?? '' });
      return json(entry);
    },
  );
}

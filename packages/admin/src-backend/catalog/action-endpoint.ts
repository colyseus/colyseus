/**
 * POST /admin-api/:resource/_action/:action — run a custom action declared
 * via `defineAdminResource({ actions: [{ name, label, perRow, handler }] })`.
 * For perRow actions the request body must include `id`; we look the row up
 * + pass it to the handler. Each invocation is audit-logged.
 */
import { createEndpoint, type Endpoint } from '@colyseus/core';
import { sqlKeyedProjection, tryAudit } from '../internal/helpers.js';
import { errorResponse, json } from '../internal/http.js';
import { pkOrError, tableOrError, type EndpointContext } from '../internal/context.js';

export function actionEndpoint(ctx: EndpointContext): Endpoint {
  return createEndpoint(
    `${ctx.apiPath}/:resource/_action/:action`,
    { method: 'POST' },
    async (reqCtx) => {
      const { resource, action: actionName } = reqCtx.params as { resource: string; action: string };
      const def = ctx.resources[resource];
      const found = def?.actions?.find((a) => a.name === actionName);
      if (!found) { return errorResponse(404, `unknown action '${actionName}' on '${resource}'`); }

      const userId = await ctx.resolveUserId({ getHeader: reqCtx.getHeader });
      if (ctx.enforceRbac) {
        if (!userId) { return errorResponse(401, 'not authenticated — sign in at /admin/login'); }
        if (found.roles && found.roles.length > 0) {
          const role = await ctx.database.moderation.getRole(userId);
          if (!found.roles.includes(role)) {
            return errorResponse(403, `forbidden: action '${actionName}' on '${resource}'`);
          }
        }
      }

      let row: any = null;
      const body = (reqCtx.body ?? {}) as { id?: string };
      if (found.perRow) {
        if (!body.id) { return errorResponse(400, `action '${actionName}' requires an id`); }
        const r = tableOrError(ctx, resource);
        if (r instanceof Response) { return r; }
        const built = pkOrError(r.cfg, body.id);
        if (built instanceof Response) { return built; }
        const rows = await ctx.database.drizzle
          .select(sqlKeyedProjection(r.cfg))
          .from(r.table)
          .where(built.where)
          .limit(1);
        if (!rows[0]) { return errorResponse(404, 'row not found'); }
        row = rows[0];
      }

      const result = await found.handler(row, { userId: userId ?? '', resource });
      await tryAudit(ctx.logger, () => ctx.database.audit.record({
        operatorId: userId ?? null,
        action: 'custom',
        resource,
        targetId: body.id ?? null,
        payload: { name: actionName, args: body, result: result ?? null },
      }));
      return json({ ok: true, result: result ?? null });
    },
  );
}

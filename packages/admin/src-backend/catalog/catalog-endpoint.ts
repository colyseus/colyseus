/**
 * GET /admin-api → resource catalog. Drives every list/show/edit/create UI
 * page on the frontend. The actual construction lives in `./builder.ts`
 * as a pure function so it stays unit-testable; this file is just the
 * HTTP wrapper.
 */
import { createEndpoint, type Endpoint } from '@colyseus/core';
import { buildResourceCatalog } from './builder.js';
import { json } from '../internal/http.js';
import { requireOperator, type EndpointContext } from '../internal/context.js';

export function catalogEndpoint(ctx: EndpointContext): Endpoint {
  return createEndpoint(ctx.apiPath, { method: 'GET' }, async (reqCtx) => {
    // Schema disclosure gate — the catalog enumerates every table,
    // column and relation. Operators only (admin/mod); never anonymous.
    const denied = await requireOperator(ctx, reqCtx);
    if (denied) { return denied; }

    return json(buildResourceCatalog({
      tables: ctx.tables,
      resources: ctx.resources,
      getTableConfig: ctx.getTableConfig,
      relations: ctx.database.relations,
    }));
  });
}

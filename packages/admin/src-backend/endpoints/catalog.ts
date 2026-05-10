/**
 * GET /admin-api → resource catalog. Drives every list/show/edit/create UI
 * page on the frontend. The actual construction lives in `../catalog.ts`
 * as a pure function so it stays unit-testable; this file is just the
 * HTTP wrapper.
 */
import { createEndpoint, type Endpoint } from '@colyseus/core';
import { buildResourceCatalog } from '../catalog.js';
import { json } from '../http.js';
import type { EndpointContext } from './context.js';

export function catalogEndpoint(ctx: EndpointContext): Endpoint {
  return createEndpoint(ctx.apiPath, { method: 'GET' }, async () => {
    return json(buildResourceCatalog({
      tables: ctx.tables,
      resources: ctx.resources,
      getTableConfig: ctx.getTableConfig,
      relations: ctx.database.relations,
    }));
  });
}

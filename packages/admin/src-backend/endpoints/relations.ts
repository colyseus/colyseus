/**
 * Two endpoints that traverse declared FK relationships:
 *
 *   GET /admin-api/:resource/:id/_counts
 *     → bulk count(*) across every many-relation on this resource. One
 *       request replaces N parallel `_start=0&_end=1` calls used to
 *       populate detail-page tab counts.
 *
 *   GET /admin-api/:resource/:id/relations/:name
 *     → paginated list of related rows (the relation's `fk` column on the
 *       target table matches this row's primary key value).
 *
 * Both rely on `database.relations` to know which targets are reachable
 * and which FK column to compare against. Relations whose target isn't
 * registered as a resource are filtered out — they'd 404 from the UI.
 */
import { createEndpoint, type Endpoint } from '@colyseus/core';
import { resolveFkLayout } from '@colyseus/database';
import { eq, sql } from 'drizzle-orm';
import { castPk, sqlKeyedProjection } from '../helpers.js';
import { errorResponse, json } from '../http.js';
import { guard, pkOrError, tableOrError, type EndpointContext } from './context.js';

// ---------------------------------------------------------------------------
// GET /admin-api/:resource/:id/_counts — counts run in Promise.all so
// wall-clock stays short.
// ---------------------------------------------------------------------------

export function countsEndpoint(ctx: EndpointContext): Endpoint {
  return createEndpoint(
    `${ctx.apiPath}/:resource/:id/_counts`,
    { method: 'GET' },
    async (reqCtx) => {
      const { resource, id } = reqCtx.params as { resource: string; id: string };
      const denied = await guard(ctx, reqCtx, 'list', resource);
      if (denied) { return denied; }

      const r = tableOrError(ctx, resource);
      if (r instanceof Response) { return r; }
      const sourcePk = r.cfg.columns.find((c) => c.primary);
      if (!sourcePk) { return errorResponse(400, 'no single-column primary key'); }
      const castedId = castPk(id, sourcePk);

      const manyRels = (ctx.database.relations[resource] ?? []).filter(
        (rel) => rel.kind === 'many' && !!ctx.tables[rel.target],
      );

      const counts: Record<string, number> = {};
      await Promise.all(
        manyRels.map(async (rel) => {
          const targetTable = ctx.tables[rel.target];
          const fkCol = (targetTable as any)[rel.fk];
          if (!fkCol) { counts[rel.name] = 0; return; }
          const rows = await ctx.database.drizzle
            .select({ c: sql<number>`count(*)` })
            .from(targetTable)
            .where(eq(fkCol, castedId));
          counts[rel.name] = Number((rows[0] as { c?: number })?.c ?? 0);
        }),
      );

      return json(counts);
    },
  );
}

// ---------------------------------------------------------------------------
// GET /admin-api/:resource/:id/relations/:name — RBAC enforced on BOTH
// the source resource (you must be able to list its relations) and the
// target resource (you must be able to see its rows).
// ---------------------------------------------------------------------------

export function relationEndpoint(ctx: EndpointContext): Endpoint {
  return createEndpoint(
    `${ctx.apiPath}/:resource/:id/relations/:name`,
    { method: 'GET' },
    async (reqCtx) => {
      const { resource, id, name } = reqCtx.params as { resource: string; id: string; name: string };
      const denied = await guard(ctx, reqCtx, 'list', resource);
      if (denied) { return denied; }

      const rel = (ctx.database.relations[resource] ?? []).find((r) => r.name === name);
      if (!rel) { return errorResponse(404, `unknown relation '${name}' on '${resource}'`); }

      const sourceTable = ctx.tables[resource];
      const targetTable = ctx.tables[rel.target];
      if (!targetTable) { return errorResponse(404, `relation '${name}' targets unknown resource '${rel.target}'`); }

      // RBAC on the *target* — viewing a parent's items respects items' policies.
      const targetDenied = await guard(ctx, reqCtx, 'list', rel.target);
      if (targetDenied) { return targetDenied; }

      // FK column may live on EITHER side (see resolveFkLayout doc) —
      // detect at runtime so we don't 500 on FK-on-source 'one' relations
      // like `cloudSaves → user`.
      const layout = resolveFkLayout(sourceTable, targetTable, rel.fk);
      if (!layout) {
        return errorResponse(500, `relation '${name}' fk '${rel.fk}' not found on '${resource}' or '${rel.target}'`);
      }

      const sourceCfg = ctx.getTableConfig(sourceTable);
      const targetCfg = ctx.getTableConfig(targetTable);

      const q = reqCtx.query ?? {};
      const start = parseInt(q._start as string) || 0;
      const end = parseInt(q._end as string) || start + 100;

      const headers = {
        'x-total-count': '0',
        'access-control-expose-headers': 'x-total-count',
      };

      if (layout.fkOn === 'target') {
        // Standard parent → child(ren). Filter target by `target.fk = source.pk`.
        // Composite-PK source tables aren't reachable here (nothing in our
        // metadata declares such a relation); we look up the single PK.
        const sourcePkCol = sourceCfg.columns.find((c) => c.primary);
        if (!sourcePkCol) {
          return errorResponse(400, `cannot resolve relation '${name}': source has no single-column primary key`);
        }
        const castedId = castPk(id, sourcePkCol);
        const rows = await ctx.database.drizzle
          .select(sqlKeyedProjection(targetCfg))
          .from(targetTable)
          .where(eq(layout.fkCol, castedId))
          .limit(end - start)
          .offset(start);
        const totalRows = await ctx.database.drizzle
          .select({ c: sql<number>`count(*)` })
          .from(targetTable)
          .where(eq(layout.fkCol, castedId));
        return json(rows, {
          headers: { ...headers, 'x-total-count': String(Number((totalRows[0] as { c?: number })?.c ?? 0)) },
        });
      }

      // FK lives on SOURCE — source row has a column pointing at target's PK.
      // Two-step: load the source row to read its FK value, then look up the
      // target by its PK. Uses pkOrError so composite-PK source rows work.
      const sourceWhere = pkOrError(sourceCfg, id);
      if (sourceWhere instanceof Response) { return sourceWhere; }
      const [sourceRow] = await ctx.database.drizzle
        .select({ fk: layout.fkCol })
        .from(sourceTable)
        .where(sourceWhere.where)
        .limit(1);
      if (!sourceRow) {
        return errorResponse(404, 'source row not found');
      }
      const fkValue = (sourceRow as { fk: unknown }).fk;
      if (fkValue == null) {
        // FK not set on the source row — relation is empty by definition.
        return json([], { headers });
      }

      const targetPkCol = targetCfg.columns.find((c) => c.primary);
      if (!targetPkCol) {
        return errorResponse(500, `cannot resolve relation '${name}': target has no single-column primary key`);
      }
      const castedFk = castPk(String(fkValue), targetPkCol);
      const rows = await ctx.database.drizzle
        .select(sqlKeyedProjection(targetCfg))
        .from(targetTable)
        .where(eq(targetPkCol as any, castedFk))
        .limit(end - start)
        .offset(start);
      // For an FK-on-source 'one' relation the result is at most 1 row, so
      // total = rows.length is exact and we skip the count(*) query.
      return json(rows, {
        headers: { ...headers, 'x-total-count': String(rows.length) },
      });
    },
  );
}

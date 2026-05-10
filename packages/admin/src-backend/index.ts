/**
 * Public entry point for `@colyseus/admin`. This file is wiring only —
 * configuration → EndpointContext → individual endpoint factories. The
 * actual handlers live in `./endpoints/*.ts`, one file per REST endpoint.
 */
import path from 'path';
import { fileURLToPath } from 'url'; // required for ESM build (see build.mjs)
import type { Endpoint } from '@colyseus/core';
import { getTableConfig as getPgTableConfig } from 'drizzle-orm/pg-core';
import { getTableConfig as getSqliteTableConfig } from 'drizzle-orm/sqlite-core';
import type { GameDatabase } from '@colyseus/database';
import type { ResourceDefinition } from './define-resource.js';
import { authEndpoints } from './auth.js';
import { readSessionFromHeader, type SessionConfig } from './sessions.js';
import { logger as defaultLogger, type Logger } from './logger.js';
import {
  type DashboardWidget,
  type DashboardPayload,
  type BuiltInWidgetId,
} from './dashboard.js';

import type { EndpointContext } from './endpoints/context.js';
import { catalogEndpoint } from './endpoints/catalog.js';
import { actionEndpoint } from './endpoints/action.js';
import {
  listEndpoint, getEndpoint, createEndpoint_, updateEndpoint, deleteEndpoint,
} from './endpoints/crud.js';
import { countsEndpoint, relationEndpoint } from './endpoints/relations.js';
import {
  healthEndpoint, dashboardEndpoint, uiIndexEndpoint, uiAssetsEndpoint,
} from './endpoints/system.js';

export { defineAdminResource } from './define-resource.js';
export type { ResourceDefinition, ResourceAction, PolicyEntry } from './define-resource.js';
export type { SessionConfig, AdminSession } from './sessions.js';
export type { DashboardWidget, DashboardPayload, BuiltInWidgetId } from './dashboard.js';
export { dashboardWidgets } from './dashboard.js';

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

  /**
   * Override the default identity resolver. Default reads the session cookie
   * (HttpOnly JWT) and falls back to the X-User-Id header iff allowDevHeader
   * is true. Provide your own to integrate with another auth scheme.
   */
  resolveUserId?: (ctx: { getHeader: (k: string) => string | null }) => Promise<string | undefined> | string | undefined;

  /** Set to false to skip RBAC entirely (dev only). */
  enforceRbac?: boolean;

  /**
   * Permit `X-User-Id: <id>` as a fallback identity source. Defaults to true
   * in dev (NODE_ENV !== "production") so puppeteer/curl can auth without a
   * real session, and false in production. Set explicitly to override.
   */
  allowDevHeader?: boolean;

  /** Session/cookie config (TTL, domain, SameSite). See SessionConfig. */
  session?: SessionConfig;

  /**
   * Pino-compatible logger (or any object with .info/.warn/.error/.child).
   * Defaults to a JSON-stdout logger; pass `null` to silence; pass your own
   * to integrate with your existing logging stack.
   */
  logger?: Logger | null;

  /**
   * Dashboard customization for the admin home page.
   *
   * Built-in widgets — `totals`, `recentUsers`, `activeEvents`, `health` —
   * are auto-included by default and can be tuned three ways:
   *
   *   1. **Pick which to keep** with `builtIns`: e.g. `['health', 'recentUsers']`
   *      drops `totals` (often noisy in real games) and `activeEvents`. Pass
   *      `[]` to disable all built-ins and ship only your own widgets.
   *   2. **Override by id** in `widgets`: a widget with `id: 'recentUsers'`
   *      replaces the built-in's data fn while preserving order.
   *   3. **Append new ids** in `widgets`: any unrecognized id is added at
   *      the end — typical for game-specific KPIs.
   *
   * For composition, the built-ins are also exported as factory functions
   * via `dashboardWidgets.{totals,recentUsers,activeEvents,health}` — pass
   * one with custom options into your `widgets` array.
   *
   * @example
   *   import { dashboardWidgets } from '@colyseus/admin';
   *   dashboard: {
   *     builtIns: ['health'],            // keep only the health widget
   *     widgets: [
   *       dashboardWidgets.recentUsers({ limit: 10 }),  // re-add, customized
   *       { id: 'rooms', render: 'kpi', data: async () => ({ active: 5 }) },
   *     ],
   *   }
   */
  dashboard?: {
    /** Built-in widget ids to auto-include. Default: all four. */
    builtIns?: BuiltInWidgetId[];
    /** Custom widgets — override built-ins by id, or append new ones. */
    widgets?: DashboardWidget[];
  };
}

/**
 * Default resolver: try the session cookie first, fall back to X-User-Id only
 * when allowDevHeader is true. Cookie-based sessions are the production path;
 * the header is dev-only convenience for puppeteer/curl.
 */
function makeDefaultResolver(allowDevHeader: boolean) {
  return async function defaultResolve(ctx: { getHeader: (k: string) => string | null }): Promise<string | undefined> {
    const session = await readSessionFromHeader(ctx.getHeader('cookie'));
    if (session) { return session.userId; }
    if (allowDevHeader) {
      return ctx.getHeader('x-user-id') ?? undefined;
    }
    return undefined;
  };
}

/**
 * Build the EndpointContext that every endpoint factory receives. Kept
 * private — endpoints should be the only consumers, and there's no reason
 * to expose this shape externally.
 */
function buildContext(opts: AdminOptions): EndpointContext {
  const { database } = opts;
  const apiPath = (opts.apiPath ?? '/admin-api').replace(/\/$/, '');
  const uiPath = (opts.uiPath ?? '/admin').replace(/\/$/, '');
  // build.mjs's "dirname" plugin rewrites __dirname to a fileURLToPath call for the ESM build
  const uiDistDir = opts.uiDistDir ?? path.resolve(__dirname, '..', 'build');
  const allowDevHeader = opts.allowDevHeader ?? (process.env.NODE_ENV !== 'production');
  const resolveUserId = opts.resolveUserId ?? makeDefaultResolver(allowDevHeader);
  const enforceRbac = opts.enforceRbac !== false;
  const logger = opts.logger === null ? null : (opts.logger ?? defaultLogger);

  const resolvedTables = opts.tables ?? database.tables;
  if (!resolvedTables) {
    throw new Error('[adminEndpoints] no tables provided — pass `tables` or call database.boot() first');
  }
  // Cast to a string-indexable map: GameDatabase types `tables` as a strict
  // mapped record (no string index signature) but the path-param lookup needs
  // a string key.
  const tables = resolvedTables as Record<string, any>;

  // Index resources by their underlying drizzle table name
  const resources = Object.fromEntries(
    Object.values(opts.resources ?? {}).map((r) => [r.__tableName, r]),
  ) as Record<string, ResourceDefinition>;

  // pg-core and sqlite-core expose getTableConfig with the same structural
  // shape. Pick once at setup based on the GameDatabase's dialect.
  const getTableConfig: (table: any) => any = (database as any).dialect === 'pg'
    ? (getPgTableConfig as any)
    : (getSqliteTableConfig as any);

  return {
    apiPath, uiPath, uiDistDir,
    database, tables, resources,
    getTableConfig, resolveUserId, enforceRbac, logger,
  };
}

/**
 * Returns an object of better-call endpoints for the admin panel — REST + static UI.
 * Spread into `createRouter({ ...adminEndpoints({ database }), yourRoutes... })`.
 */
export function adminEndpoints(opts: AdminOptions): Record<string, Endpoint> {
  const ctx = buildContext(opts);

  // Auth endpoints (login/logout/bootstrap/me/status). Spread alongside the
  // CRUD endpoints so consumers get one map to spread into createRouter.
  const auth = authEndpoints({
    database: opts.database,
    apiPath: ctx.apiPath,
    session: opts.session ?? {},
  });

  return {
    ...auth,
    adminHealthcheck: healthEndpoint(ctx),
    adminDashboard:   dashboardEndpoint(ctx, opts.dashboard),

    adminResources:   catalogEndpoint(ctx),
    adminCounts:      countsEndpoint(ctx),
    adminRelation:    relationEndpoint(ctx),
    adminAction:      actionEndpoint(ctx),

    adminList:        listEndpoint(ctx),
    adminGet:         getEndpoint(ctx),
    adminCreate:      createEndpoint_(ctx),
    // PUT and PATCH share a handler — @refinedev/simple-rest sends PATCH for
    // `update` by default, but accepting PUT keeps custom clients working.
    adminUpdate:      updateEndpoint(ctx, 'PUT'),
    adminPatch:       updateEndpoint(ctx, 'PATCH'),
    adminDelete:      deleteEndpoint(ctx),

    adminUiIndex:     uiIndexEndpoint(ctx),
    adminUiAssets:    uiAssetsEndpoint(ctx),
  };
}

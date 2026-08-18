/**
 * Public entry point for `@colyseus/admin`. This file is wiring only —
 * configuration → EndpointContext → individual endpoint factories. The
 * actual handlers live in `./endpoints/*.ts`, one file per REST endpoint.
 */
import path from 'path';
import { dualModeEndpoints, type Endpoint } from '@colyseus/core';
import { getTableConfig as getPgTableConfig } from 'drizzle-orm/pg-core';
import { getTableConfig as getSqliteTableConfig } from 'drizzle-orm/sqlite-core';
import { GameDatabase } from '@colyseus/database';
import type { ResourceDefinition } from './catalog/define-resource.js';
import { JWT } from '@colyseus/auth';
import { authEndpoints } from './auth/endpoints.js';
import { readSessionFromHeader, type SessionConfig } from './auth/sessions.js';
import { sessionGuard } from './auth/guard.js';
import { logger as defaultLogger, type Logger } from './internal/logger.js';
import {
  createTokenBucketLimiter,
  type RateLimiter,
} from './auth/rate-limit.js';
import {
  type DashboardWidget,
  type DashboardPayload,
  type DashboardPresets,
} from './dashboard/widgets.js';

import type { EndpointContext } from './internal/context.js';
import { catalogEndpoint } from './catalog/catalog-endpoint.js';
import { actionEndpoint } from './catalog/action-endpoint.js';
import {
  listEndpoint, getEndpoint, createEndpoint_, updateEndpoint, deleteEndpoint,
} from './catalog/crud-endpoint.js';
import { countsEndpoint, relationEndpoint } from './catalog/relations-endpoint.js';
import {
  listRoomsEndpoint, listRoomsByUserEndpoint,
  inspectRoomEndpoint, kickClientEndpoint, lockRoomEndpoint,
  editRoomStateEndpoint, deleteRoomStateEndpoint, disposeRoomEndpoint,
} from './rooms/endpoint.js';
import {
  banUserEndpoint, unbanUserEndpoint, revokeSessionsEndpoint,
} from './users/endpoint.js';
// Side-effect import: monkey-patches `Room.prototype` with the
// `_editStateProperty` / `_deleteStateProperty` hooks the inspector's
// state-editor calls via `matchMaker.remoteRoomCall`. Must run before
// the endpoints below are wired — they reference the patched methods.
import './rooms/room-patch.js';
import {
  dashboardEndpoint, dashboardWidgetEndpoint, resolveDashboardWidgets,
} from './dashboard/endpoint.js';
import {
  healthEndpoint, uiIndexEndpoint, uiAssetsEndpoint,
} from './system/endpoint.js';

export { defineAdminResource } from './catalog/define-resource.js';
export type { ResourceDefinition, ResourceAction, PolicyEntry } from './catalog/define-resource.js';
export type { SessionConfig, AdminSession } from './auth/sessions.js';
export type { AdminGuardOptions } from './auth/guard.js';
export {
  createTokenBucketLimiter,
  ipFromHeaders,
  type RateLimiter,
  type TokenBucketOptions,
} from './auth/rate-limit.js';
export type {
  DashboardWidget, DashboardPayload, DashboardWidgetEntry,
  DashboardPresets, WidgetRender,
  TableWidgetData, UserColumnName, LiveRoomColumnName,
  TotalsPresetOptions, RecentUsersPresetOptions, LiveRoomsPresetOptions,
  HealthPresetOptions, SegmentsPresetOptions,
} from './dashboard/widgets.js';
export { ADMIN_ICON_NAMES, type AdminIconName } from './display/icons.js';

export interface AdminOptions {
  /** Defaults to `GameDatabase.current`. Pass explicitly for multi-database setups. */
  database?: GameDatabase;

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
   * Minimum password length accepted by `/auth/bootstrap` and
   * `/auth/reset`. Default `8`. Anything shorter is rejected with 400
   * before the password is hashed. Plain length check — caller's
   * responsibility to layer on stronger rules (zxcvbn, etc.) if needed.
   */
  minPasswordLength?: number;

  /**
   * Deliver a password reset link to the user. Called from
   * `/auth/request-reset` with the short-lived signed token + the
   * canonical reset URL (`<uiPath>/reset?token=<token>`). The default
   * is to log the URL via the admin logger so local dev works without
   * SMTP — production users plug in their mailer:
   *
   *   onResetRequest: async ({ email, url }) => {
   *     await mailer.send({ to: email, subject: 'Reset password',
   *                          html: `<a href="${url}">Reset</a>` });
   *   }
   *
   * The function is fire-and-forget — its errors don't propagate to
   * the client so the endpoint can't be used to probe whether an
   * email exists (the response is always 200).
   */
  onResetRequest?: (ctx: {
    email: string;
    userId: string;
    /** Signed JWT to pass back to `/auth/reset`. */
    token: string;
    /** Pre-built URL pointing at the panel's reset page. */
    url: string;
  }) => void | Promise<void>;

  /**
   * Rate limiters for the auth endpoints. Defaults to an in-memory token
   * bucket per limiter (10/min for login, 5/min for bootstrap). Pass `false`
   * to disable, or a custom `RateLimiter` to swap in a Redis-backed
   * implementation for multi-node deployments.
   *
   *   rateLimit: {
   *     login: createTokenBucketLimiter({ capacity: 5, refillPerSec: 1/30 }),
   *     bootstrap: false, // disabled
   *   }
   */
  rateLimit?: {
    login?: RateLimiter | false;
    bootstrap?: RateLimiter | false;
    /** Per-(ip, email) limit on /auth/request-reset. Default ~1/min. */
    requestReset?: RateLimiter | false;
  };

  /**
   * Dashboard customization for the admin home page.
   *
   * Two knobs:
   *
   *   - `presets` — built-in widgets (`totals`, `recentUsers`, `liveRooms`,
   *     `health`, `segments`). All enabled by default; pass `false` to
   *     disable one, or an options object to customize its title/icon/span
   *     and the preset-specific knobs (e.g. `recentUsers: { limit: 10 }`).
   *
   *   - `widgets` — user-defined widgets, appended after the presets. `id`
   *     is optional and defaults to `slugify(title)`. Reusing a preset id
   *     here throws at setup time — configure presets through `presets`,
   *     not by shadowing them.
   *
   * @example
   *   dashboard: {
   *     presets: {
   *       totals: { only: ['users', 'rooms'] },
   *       recentUsers: { limit: 10 },
   *       health: false,
   *       // segments: omitted → enabled with defaults
   *     },
   *     widgets: [
   *       { title: 'Rooms', icon: 'cluster', render: 'kpi',
   *         data: async () => ({ active: 5 }) },
   *     ],
   *   }
   */
  dashboard?: {
    /** Built-in widget configuration. All enabled by default. */
    presets?: DashboardPresets;
    /** User-defined widgets appended after the presets. */
    widgets?: DashboardWidget[];
  };
}

/**
 * Default resolver: try the session cookie first, fall back to X-User-Id only
 * when allowDevHeader is true. Cookie-based sessions are the production path;
 * the header is dev-only convenience for puppeteer/curl.
 */
/**
 * Verify a JWT signing secret is configured before the admin endpoints
 * boot. In production this throws; outside production it just warns
 * once (so dev workflows still work without exporting JWT_SECRET).
 *
 * Bootstrapping without a secret would result in unsignable session
 * tokens — a silent failure at first login. Better to fail loudly at
 * `admin()` setup.
 */
let jwtWarnedOnce = false;
function assertJwtSecretConfigured(): void {
  const secret = (JWT as any).settings?.secret || process.env.JWT_SECRET;
  if (secret) { return; }

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      '[admin] JWT_SECRET is required in production — admin sessions ' +
      'cannot be signed without it. Set the JWT_SECRET environment variable or ' +
      'assign JWT.settings.secret before calling admin().',
    );
  }

  if (!jwtWarnedOnce) {
    jwtWarnedOnce = true;
    // eslint-disable-next-line no-console
    console.warn(
      '[admin] No JWT secret configured. Admin sessions will fail to ' +
      'sign. Set JWT_SECRET (env) or JWT.settings.secret before deploying.',
    );
  }
}

/**
 * Resolve a rate-limit option into the actual `RateLimiter` the auth
 * endpoint should call. `undefined` → use the default token bucket;
 * `false` → no-op limiter (always allows); a `RateLimiter` instance
 * → use as-is.
 */
function resolveLimiter(
  override: RateLimiter | false | undefined,
  defaults: { capacity: number; refillPerSec: number; retryAfterSec?: number },
): RateLimiter {
  if (override === false) { return { check: () => null }; }
  if (override) { return override; }
  return createTokenBucketLimiter(defaults);
}

/**
 * Built-in resource defaults applied at `admin()` time. Each entry
 * is keyed by the canonical table name and runs only when:
 *   - the GameDatabase has that table (i.e. the user is using the
 *     built-in `roles`/`userNotes`/etc. schemas), AND
 *   - the user hasn't already supplied an override via
 *     `defineAdminResource(<table>, {...})`.
 *
 * Add new entries here when a built-in table has a convention that should
 * "just work" without user wiring.
 */
function applyBuiltInResourceDefaults(
  resources: Record<string, ResourceDefinition>,
  tables: Record<string, any>,
): void {
  const builtIns: Record<string, () => Partial<ResourceDefinition>> = {
    userNotes: () => ({
      create: {
        defaults: ({ operatorId }) => ({ authorId: operatorId }),
      },
    }),
    // Audit log — append-only by contract. Writes are denied for
    // *everyone* (including admin) so a compromised account can't
    // tamper with the record retroactively; pruning happens out-of-
    // band (cron / SQL job). Reads are admin-only because the payload
    // can contain sensitive before/after row data.
    adminAudit: () => ({
      label: 'Audit log',
      icon: 'file-text',
      policies: {
        list:   ['admin'],
        read:   ['admin'],
        create: 'deny',
        update: 'deny',
        delete: 'deny',
      },
      list: {
        // `payload` is here even though it's not in the generic
        // list-table's column header order — the projection limits
        // the API response to these columns, and the user-show
        // Audit tab needs `payload` to render reason / until / diff.
        // The standalone /adminAudit list page renders it as a
        // truncated JSON cell via `formatCell`.
        columns: ['created_at', 'operator_id', 'action', 'resource', 'target_id', 'payload'],
        defaultSort: { field: 'created_at', order: 'desc' },
      },
      show: {
        fields: ['created_at', 'operator_id', 'action', 'resource', 'target_id', 'payload'],
      },
      columns: {
        created_at:  { label: 'When' },
        operator_id: { label: 'Operator' },
        // Target table varies per row, so deep-link via the sibling
        // `resource` column (e.g. resource='users' → /users/show/<id>).
        // Unknown resources (e.g. 'auth') render as plain text.
        target_id:   { label: 'Target', linkTo: { resourceFromColumn: 'resource' } },
      },
    }),
  };
  for (const [canonical, factory] of Object.entries(builtIns)) {
    if (!tables[canonical]) { continue; }   // not on this database
    if (resources[canonical]) { continue; } // user override wins
    const sqlName = (tables[canonical] as any)?.[Symbol.for('drizzle:Name')] ?? canonical;
    resources[canonical] = { __tableName: sqlName, ...factory() };
  }
}

function makeDefaultResolver(allowDevHeader: boolean, database: GameDatabase) {
  return async function defaultResolve(ctx: { getHeader: (k: string) => string | null }): Promise<string | undefined> {
    const session = await readSessionFromHeader(ctx.getHeader('cookie'));
    if (session) {
      // Token-version revocation check. The JWT carries the `tv` the
      // user had at sign time; if the row's current version is higher,
      // the session was revoked (password reset, "sign out everywhere",
      // forced rotation) and we reject the cookie as if it were
      // unauthenticated. Sessions issued before `tv` was added (no
      // `tv` claim) are accepted — backward compat with cookies still
      // in flight when the column lands.
      if (session.tv !== undefined) {
        const current = await database.auth.getTokenVersion(session.userId);
        if (current !== session.tv) { return undefined; }
      }
      return session.userId;
    }
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
  const database = opts.database ?? GameDatabase.current;
  if (!database) {
    throw new Error(
      '[admin] no GameDatabase available — construct `new GameDatabase(...)` before calling admin(), or pass `database:` explicitly',
    );
  }
  const apiPath = (opts.apiPath ?? '/admin-api').replace(/\/$/, '');
  const uiPath = (opts.uiPath ?? '/admin').replace(/\/$/, '');
  const uiDistDir = opts.uiDistDir ?? path.resolve(import.meta.dirname, '..', 'build');
  const allowDevHeader = opts.allowDevHeader ?? (process.env.NODE_ENV !== 'production');
  const resolveUserId = opts.resolveUserId ?? makeDefaultResolver(allowDevHeader, database);
  const enforceRbac = opts.enforceRbac !== false;
  const logger = opts.logger === null ? null : (opts.logger ?? defaultLogger);

  const resolvedTables = opts.tables ?? database.tables;
  if (!resolvedTables) {
    throw new Error('[admin] no tables provided — pass `tables` or call database.boot() first');
  }
  // Cast to a string-indexable map: GameDatabase types `tables` as a strict
  // mapped record (no string index signature) but the path-param lookup needs
  // a string key.
  const tables = resolvedTables as Record<string, any>;

  // Index resources by their CANONICAL table name (the key in `tables` —
  // `userNotes`, not `colyseus_user_notes`) so CRUD/catalog lookups can use
  // the same key as the URL path param. `defineAdminResource` records the
  // drizzle SQL name on `__tableName`; reverse-map to the canonical key via
  // the resolved `tables` record. User resources for tables that aren't
  // registered fall back to their SQL name (preserving the historical
  // behavior for user-defined tables where canonical === SQL).
  const sqlToCanonical: Record<string, string> = {};
  for (const [canonical, t] of Object.entries(tables)) {
    const sqlName = (t as any)?.[Symbol.for('drizzle:Name')];
    if (typeof sqlName === 'string') {
      sqlToCanonical[sqlName] = canonical;
    }
  }
  const resources: Record<string, ResourceDefinition> = {};
  for (const r of Object.values(opts.resources ?? {})) {
    const canonical = sqlToCanonical[r.__tableName] ?? r.__tableName;
    resources[canonical] = r;
  }

  // Built-in resource defaults. Applied only when the user hasn't supplied
  // their own override for the same canonical name, so it's safe to
  // override by passing `defineAdminResource(userNotes, {...})`.
  applyBuiltInResourceDefaults(resources, tables);

  // pg-core and sqlite-core expose getTableConfig with the same structural
  // shape. Pick once at setup based on the GameDatabase's dialect.
  const getTableConfig: (table: any) => any = database.dialect === 'pg'
    ? (getPgTableConfig as any)
    : (getSqliteTableConfig as any);

  return {
    apiPath, uiPath, uiDistDir,
    database, tables, resources,
    getTableConfig, resolveUserId, enforceRbac, logger,
  };
}

/**
 * Better-call endpoint map for the admin panel — REST API + static UI. Spread
 * into `createRouter({ ...admin({ database }), yourRoutes... })`. The same
 * return value is also a valid express middleware: `app.use("/", admin({...}))`.
 *
 * Session guard for sibling apps lives at `admin.guard()` (mirrors
 * `auth.middleware()`): `playground({ use: [admin.guard()] })`. It's a
 * static helper — no panel instance needed; `loginUrl` defaults to
 * `/admin` (pass `admin.guard({ loginUrl })` if you customize uiPath).
 */
function adminImpl(opts: AdminOptions) {
  // In production, refuse to boot without a JWT secret — admin sessions
  // would otherwise be unsignable (and the failure would surface only
  // at the first login attempt, not at startup). Devs without an env
  // var get a one-time warning so the workflow still works locally.
  assertJwtSecretConfigured();

  const ctx = buildContext(opts);

  // Resolve rate limiters. Defaults are tuned for "single bad actor"
  // protection: 10 login attempts per minute per (ip, email) and ~1
  // bootstrap per minute per ip. Operators can pass `false` to disable
  // or a custom `RateLimiter` (Redis-backed, etc.).
  const loginLimiter = resolveLimiter(opts.rateLimit?.login, {
    capacity: 10, refillPerSec: 1 / 6, retryAfterSec: 6,
  });
  const bootstrapLimiter = resolveLimiter(opts.rateLimit?.bootstrap, {
    capacity: 5, refillPerSec: 1 / 60, retryAfterSec: 60,
  });
  const requestResetLimiter = resolveLimiter(opts.rateLimit?.requestReset, {
    capacity: 3, refillPerSec: 1 / 60, retryAfterSec: 60,
  });

  // Auth endpoints (login/logout/bootstrap/me/status). Spread alongside the
  // CRUD endpoints so consumers get one map to spread into createRouter.
  const auth = authEndpoints({
    database: ctx.database,
    apiPath: ctx.apiPath,
    uiPath: ctx.uiPath,
    session: opts.session ?? {},
    loginLimiter,
    bootstrapLimiter,
    requestResetLimiter,
    minPasswordLength: opts.minPasswordLength ?? 8,
    onResetRequest: opts.onResetRequest,
    logger: ctx.logger,
  });

  // Dashboard widgets are resolved once at setup time; both the full
  // dashboard endpoint and the per-widget refresh endpoint dispatch
  // from the same list.
  const dashboardWidgets = resolveDashboardWidgets(opts.dashboard);

  const endpoints: Record<string, Endpoint> = {
    ...auth,
    adminHealthcheck:    healthEndpoint(ctx),
    adminDashboard:      dashboardEndpoint(ctx, dashboardWidgets),
    adminDashboardWidget: dashboardWidgetEndpoint(ctx, dashboardWidgets),

    adminResources:   catalogEndpoint(ctx),
    adminCounts:      countsEndpoint(ctx),
    adminRelation:    relationEndpoint(ctx),
    adminAction:      actionEndpoint(ctx),

    // Live room inspector. The four routes share a synthetic
    // `rooms` resource for RBAC — guard() against `list` for read,
    // `update` for kick, `delete` for dispose. Override via
    // `defineAdminResource(<rooms-table>, { policies: ... })` if
    // you want a tighter rule (mods who can view but not kick, etc.).
    adminRoomsList:    listRoomsEndpoint(ctx),
    // `/rooms/by-user/:userId` doesn't conflict with `/rooms/:roomId`
    // because the underlying rou3 trie router prefers static segments
    // over parameters — the literal `by-user` wins regardless of
    // registration order. Listed here for grouping only.
    adminRoomsByUser:  listRoomsByUserEndpoint(ctx),
    adminRoomInspect:  inspectRoomEndpoint(ctx),
    adminRoomKick:     kickClientEndpoint(ctx),
    adminRoomLock:     lockRoomEndpoint(ctx),
    adminRoomStateEdit:   editRoomStateEndpoint(ctx),
    adminRoomStateDelete: deleteRoomStateEndpoint(ctx),
    adminRoomDispose:  disposeRoomEndpoint(ctx),

    // User-targeted operator workflows. Each delegates to a
    // database.auth.* service method and audit-logs as user.*.
    // The endpoints sit alongside the generic CRUD (which handles
    // shape-uniform mutations) — these exist for multi-column /
    // multi-method workflows that don't fit a PATCH.
    adminUserBan:            banUserEndpoint(ctx),
    adminUserUnban:          unbanUserEndpoint(ctx),
    adminUserRevokeSessions: revokeSessionsEndpoint(ctx),

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

  // Express compat — routing decisions key off req.originalUrl (the same
  // string better-call's getRequest uses to build the dispatched Request URL),
  // so the middleware's match check and the actual dispatch always agree.
  return dualModeEndpoints(endpoints, {
    catchAllKey: 'adminUiAssets',
    buildMiddleware: ({ specificRouter, specificHandler, fullHandler }) => (req, res, next) => {
      const dispatchUrl = ((req as any).originalUrl ?? req.url ?? '').split('?')[0]!;
      const method = req.method ?? 'GET';

      // Bare-uiPath (`/admin`) → 301 to canonical `/admin/`.
      if (method === 'GET' && dispatchUrl === ctx.uiPath) {
        res.writeHead(301, { location: `${ctx.uiPath}/` });
        res.end();
        return;
      }

      const route = specificRouter.findRoute(method, dispatchUrl);
      // route.data.path is the route template (e.g. `/admin-api/:resource`),
      // so we can't compare it strictly against the dispatched URL. Trust
      // findRoute for parameterized routes; only skip when the template ends
      // in `/` and the dispatched URL doesn't (rou3 normalizes trailing
      // slashes in findRoute but processRequest does exact-match).
      if (route && (!route.data?.path?.endsWith('/') || dispatchUrl.endsWith('/'))) {
        return specificHandler(req as any, res as any).catch(next);
      }

      // GET under uiPath → SPA fallback via the catch-all so React Router
      // routes (e.g. `/admin/users/42`) serve index.html on direct visit.
      if (method === 'GET' && dispatchUrl.startsWith(ctx.uiPath + '/')) {
        return fullHandler(req as any, res as any).catch(next);
      }

      next();
    },
  });
}

/**
 * `admin` is the endpoint-map factory; `admin.guard` is the session
 * middleware for gating sibling apps (monitor/playground) behind the
 * same login. Attached as a static (not an instance method) so the
 * call site stays `admin.guard()` with no panel hoisting.
 */
export const admin = Object.assign(adminImpl, { guard: sessionGuard });

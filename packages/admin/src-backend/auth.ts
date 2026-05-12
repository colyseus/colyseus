import { count, eq } from 'drizzle-orm';
import { Hash } from '@colyseus/auth';
import { createEndpoint, type Endpoint } from '@colyseus/core';
import type { GameDatabase } from '@colyseus/database';
import { json, errorResponse } from './http.js';
import {
  signSession,
  setSessionCookie,
  clearSessionCookie,
  readSessionFromHeader,
  type AdminSession,
  type SessionConfig,
} from './sessions.js';
import { ipFromHeaders, type RateLimiter } from './rate-limit.js';

export interface AuthEndpointsOptions {
  database: GameDatabase;
  apiPath: string;
  session?: SessionConfig;
  /** Per-(ip, email) limiter applied to `/auth/login`. */
  loginLimiter?: RateLimiter;
  /** Per-ip limiter applied to `/auth/bootstrap`. */
  bootstrapLimiter?: RateLimiter;
}

/**
 * Factory: builds the auth endpoints (login/logout/register/bootstrap/me/status).
 *
 * Bootstrap flow: the very first call to POST /auth/bootstrap promotes the
 * caller to admin without requiring auth — but only succeeds while zero admins
 * exist in the DB. Subsequent calls return 403. This makes `curl /auth/bootstrap`
 * a safe one-shot setup primitive.
 */
export function authEndpoints(opts: AuthEndpointsOptions): Record<string, Endpoint> {
  const { database, apiPath, session = {} } = opts;
  const loginLimiter = opts.loginLimiter;
  const bootstrapLimiter = opts.bootstrapLimiter;

  /** Read the cookie or null. Used by both this module and guard(). */
  async function currentSession(ctx: any): Promise<AdminSession | null> {
    const cookie = ctx.getHeader('cookie');
    return readSessionFromHeader(cookie);
  }

  /**
   * Append a row to the audit log for an auth event. Wraps in try/catch
   * — a failing audit insert must never break the auth flow itself
   * (the user still needs to sign in even if logging is broken). Adds
   * the request IP + user-agent automatically so the payload survives
   * a forensic review without the endpoint needing to remember them.
   */
  async function tryAuditAuth(
    action: 'auth.login' | 'auth.login_failed' | 'auth.logout' | 'auth.bootstrap',
    userId: string | null,
    ctx: any,
    extra: Record<string, unknown>,
  ): Promise<void> {
    try {
      const payload = {
        ip: ipFromHeaders(ctx.getHeader),
        userAgent: ctx.getHeader('user-agent') ?? null,
        ...extra,
      };
      await database.audit.record({
        operatorId: userId,
        action,
        resource: 'auth',
        targetId: userId,
        payload,
      });
    } catch {
      // Intentionally swallow — auth must succeed even if audit fails.
    }
  }

  async function adminCount(): Promise<number> {
    const rows = await database.drizzle
      .select({ c: count() })
      .from(database.tables.roles)
      .where(eq(database.tables.roles.role, 'admin'));
    return Number(rows[0]?.c ?? 0);
  }

  async function findUserByEmail(email: string): Promise<any> {
    return database.auth.settings.onFindUserByEmail!(email);
  }

  async function hashPassword(plain: string): Promise<string> {
    return Hash.make(plain);
  }

  return {
    // GET /admin-api/auth/status — reports whether bootstrap is needed.
    // Public (no session required) so the login screen can decide what to render.
    authStatus: createEndpoint(`${apiPath}/auth/status`, { method: 'GET' }, async (ctx) => {
      const total = await adminCount();
      const me = await currentSession(ctx);
      return json({
        needsBootstrap: total === 0,
        authenticated: !!me,
        userId: me?.userId ?? null,
        role: me?.role ?? null,
      });
    }),

    // GET /admin-api/auth/me — current session info, 401 if not signed in.
    authMe: createEndpoint(`${apiPath}/auth/me`, { method: 'GET' }, async (ctx) => {
      const me = await currentSession(ctx);
      if (!me) { return errorResponse(401, 'not authenticated'); }
      return json({ userId: me.userId, role: me.role });
    }),

    // POST /admin-api/auth/bootstrap — first-run admin creation.
    // Body: { email, password }. Refused once any admin exists.
    authBootstrap: createEndpoint(`${apiPath}/auth/bootstrap`, { method: 'POST' }, async (ctx) => {
      if (bootstrapLimiter) {
        const blocked = await bootstrapLimiter.check(`bootstrap:${ipFromHeaders(ctx.getHeader)}`);
        if (blocked) { return blocked; }
      }
      const total = await adminCount();
      if (total > 0) {
        return errorResponse(403, 'bootstrap is only available before the first admin is created');
      }
      const body = (ctx.body ?? {}) as { email?: string; password?: string };
      if (!body.email || !body.password) {
        return errorResponse(400, 'email and password are required');
      }

      const existing = await findUserByEmail(body.email);
      if (existing) {
        // Promote the existing user (covers the "I registered first then bootstrapped" case)
        await database.moderation.setRole(existing.id, 'admin');
        const token = await signSession({ userId: existing.id, role: 'admin' }, session);
        await tryAuditAuth('auth.bootstrap', existing.id, ctx, { email: body.email, promoted: true });
        return json(
          { ok: true, userId: existing.id, role: 'admin' },
          { headers: { 'set-cookie': setSessionCookie(token, session) } },
        );
      }

      const hashed = await hashPassword(body.password);
      await database.auth.settings.onRegisterWithEmailAndPassword!(body.email, hashed, {});
      const created = await findUserByEmail(body.email);
      if (!created) {
        return errorResponse(500, 'bootstrap: user creation succeeded but lookup failed');
      }
      await database.moderation.setRole(created.id, 'admin');
      const token = await signSession({ userId: created.id, role: 'admin' }, session);
      await tryAuditAuth('auth.bootstrap', created.id, ctx, { email: body.email });
      return json(
        { ok: true, userId: created.id, role: 'admin' },
        { headers: { 'set-cookie': setSessionCookie(token, session) } },
      );
    }),

    // POST /admin-api/auth/login — { email, password } → session cookie.
    // Comparison goes through Hash.verify so the credential check is
    // constant-time and the stored value carries its own per-user salt
    // (see @colyseus/auth's Hash). The findByEmail row returns the hash
    // under `user.password` (mapped from the `passwordHash` column).
    authLogin: createEndpoint(`${apiPath}/auth/login`, { method: 'POST' }, async (ctx) => {
      const body = (ctx.body ?? {}) as { email?: string; password?: string };
      if (!body.email || !body.password) {
        return errorResponse(400, 'email and password are required');
      }
      if (loginLimiter) {
        // Key on (ip, email) so a single bad actor can only lock their
        // own target out, not deny service to other admins from the
        // same IP block. Email is lowercased for case-insensitive
        // bucketing (Email matching elsewhere is provider-defined; the
        // limiter doesn't need to agree, just be conservative).
        const ip = ipFromHeaders(ctx.getHeader);
        const key = `login:${ip}:${body.email.toLowerCase()}`;
        const blocked = await loginLimiter.check(key);
        if (blocked) { return blocked; }
      }
      const user = await findUserByEmail(body.email);
      if (!user || !(await Hash.verify(body.password, user.password))) {
        // Record the failure with the attempted email so operators can
        // grep `auth.login_failed` for credential-stuffing patterns.
        // `operatorId` is the matched user's id (if the email existed
        // but the password didn't), or null when the email is unknown.
        await tryAuditAuth('auth.login_failed', user?.id ?? null, ctx, { email: body.email });
        return errorResponse(401, 'invalid credentials');
      }

      const role = await database.moderation.getRole(user.id);
      const token = await signSession({ userId: user.id, role }, session);
      await tryAuditAuth('auth.login', user.id, ctx, { email: body.email });
      return json(
        { userId: user.id, role },
        { headers: { 'set-cookie': setSessionCookie(token, session) } },
      );
    }),

    // POST /admin-api/auth/logout — clears the session cookie (idempotent).
    authLogout: createEndpoint(`${apiPath}/auth/logout`, { method: 'POST' }, async (ctx) => {
      const me = await currentSession(ctx);
      if (me) {
        await tryAuditAuth('auth.logout', me.userId, ctx, {});
      }
      return json(
        { ok: true },
        { headers: { 'set-cookie': clearSessionCookie(session) } },
      );
    }),

    // POST /admin-api/auth/register — self-serve registration.
    // Defaults to disabled — gated behind enableRegistration: true on adminEndpoints.
    // (See index.ts; this endpoint is only mounted when the option is set.)
  };
}

import { count, eq } from 'drizzle-orm';
import { Hash } from '@colyseus/auth';
import { createEndpoint, type Endpoint } from '@colyseus/core';
import type { GameDatabase } from '@colyseus/database';
import { json, errorResponse } from './respond.js';
import {
  signSession,
  setSessionCookie,
  clearSessionCookie,
  readSessionFromHeader,
  type AdminSession,
  type SessionConfig,
} from './sessions.js';

export interface AuthEndpointsOptions {
  database: GameDatabase;
  apiPath: string;
  session?: SessionConfig;
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

  /** Read the cookie or null. Used by both this module and guard(). */
  async function currentSession(ctx: any): Promise<AdminSession | null> {
    const cookie = ctx.getHeader('cookie');
    return readSessionFromHeader(cookie);
  }

  async function adminCount(): Promise<number> {
    const rows = await database.drizzle
      .select({ c: count() })
      .from(database.tables.userRoles)
      .where(eq(database.tables.userRoles.role, 'admin'));
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
      return json(
        { ok: true, userId: created.id, role: 'admin' },
        { headers: { 'set-cookie': setSessionCookie(token, session) } },
      );
    }),

    // POST /admin-api/auth/login — { email, password } → session cookie.
    authLogin: createEndpoint(`${apiPath}/auth/login`, { method: 'POST' }, async (ctx) => {
      const body = (ctx.body ?? {}) as { email?: string; password?: string };
      if (!body.email || !body.password) {
        return errorResponse(400, 'email and password are required');
      }
      const user = await findUserByEmail(body.email);
      if (!user) { return errorResponse(401, 'invalid credentials'); }
      const hashed = await hashPassword(body.password);
      // findByEmail maps `user.password` from `passwordHash`
      if (!user.password || user.password !== hashed) {
        return errorResponse(401, 'invalid credentials');
      }

      const role = await database.moderation.getRole(user.id);
      const token = await signSession({ userId: user.id, role }, session);
      return json(
        { userId: user.id, role },
        { headers: { 'set-cookie': setSessionCookie(token, session) } },
      );
    }),

    // POST /admin-api/auth/logout — clears the session cookie (idempotent).
    authLogout: createEndpoint(`${apiPath}/auth/logout`, { method: 'POST' }, async () => {
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

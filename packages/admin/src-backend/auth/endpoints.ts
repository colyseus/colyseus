import { count, eq } from 'drizzle-orm';
import { Hash, JWT } from '@colyseus/auth';
import { createEndpoint, type Endpoint } from '@colyseus/core';
import type { GameDatabase } from '@colyseus/database';
import { json, errorResponse } from '../internal/http.js';
import {
  signSession,
  setSessionCookie,
  clearSessionCookie,
  readSessionFromHeader,
  type AdminSession,
  type SessionConfig,
} from './sessions.js';
import { ipFromHeaders, type RateLimiter } from './rate-limit.js';
import type { Logger } from '../internal/logger.js';

/** Claims embedded in a password-reset JWT. */
interface ResetTokenClaims {
  /** User id this token authorizes a password change for. */
  sub: string;
  /** Tag — refuses non-reset tokens (e.g. someone passing a session cookie's JWT). */
  kind: 'reset';
  /** User's `tokenVersion` at issue time. After a successful reset
   *  the version is bumped, so reusing the same token (or another
   *  outstanding token from a prior /request-reset call) is rejected. */
  tv: number;
}

const RESET_TOKEN_TTL_SECONDS = 15 * 60; // 15 minutes

export interface AuthEndpointsOptions {
  database: GameDatabase;
  apiPath: string;
  /** Admin UI path — used to build the reset URL passed to `onResetRequest`. */
  uiPath?: string;
  session?: SessionConfig;
  /** Per-(ip, email) limiter applied to `/auth/login`. */
  loginLimiter?: RateLimiter;
  /** Per-ip limiter applied to `/auth/bootstrap`. */
  bootstrapLimiter?: RateLimiter;
  /** Per-(ip, email) limiter applied to `/auth/request-reset`. */
  requestResetLimiter?: RateLimiter;
  /** Min password length for /bootstrap and /reset. Default 8. */
  minPasswordLength?: number;
  /** Hook invoked when /request-reset succeeds. Default logs the URL. */
  onResetRequest?: (ctx: {
    email: string;
    userId: string;
    token: string;
    url: string;
  }) => void | Promise<void>;
  /** Used by the default `onResetRequest` to log the reset URL. */
  logger?: Logger | null;
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
  const uiPath = opts.uiPath ?? '/admin';
  const loginLimiter = opts.loginLimiter;
  const bootstrapLimiter = opts.bootstrapLimiter;
  const requestResetLimiter = opts.requestResetLimiter;
  const minPasswordLength = opts.minPasswordLength ?? 8;
  const logger = opts.logger;
  const onResetRequest = opts.onResetRequest ?? (({ email, url }) => {
    logger?.info?.({ event: 'password_reset_link', email, url },
      `[admin] password reset link for ${email}: ${url}`);
  });

  /**
   * Read the cookie + verify the JWT, then validate that the embedded
   * `tv` (token version) still matches the row's current value. A bumped
   * `tokenVersion` (set by password reset / "log out everywhere" /
   * forced rotation) takes effect immediately, even for cookies still
   * sitting in the user's browser. Sessions signed before the column
   * existed (no `tv` claim) bypass the check — backward compat.
   */
  async function currentSession(ctx: any): Promise<AdminSession | null> {
    const cookie = ctx.getHeader('cookie');
    const session = await readSessionFromHeader(cookie);
    if (!session) { return null; }
    if (session.tv !== undefined) {
      const current = await database.auth.getTokenVersion(session.userId);
      if (current !== session.tv) { return null; }
    }
    return session;
  }

  /**
   * Append a row to the audit log for an auth event. Wraps in try/catch
   * — a failing audit insert must never break the auth flow itself
   * (the user still needs to sign in even if logging is broken). Adds
   * the request IP + user-agent automatically so the payload survives
   * a forensic review without the endpoint needing to remember them.
   */
  async function tryAuditAuth(
    action:
      | 'auth.login'
      | 'auth.login_failed'
      | 'auth.logout'
      | 'auth.bootstrap'
      | 'auth.password_reset_requested'
      | 'auth.password_reset_completed',
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
      if (body.password.length < minPasswordLength) {
        return errorResponse(400, `password must be at least ${minPasswordLength} characters`);
      }

      const existing = await findUserByEmail(body.email);
      if (existing) {
        // Promote the existing user (covers the "I registered first then bootstrapped" case)
        await database.moderation.setRole(existing.id, 'admin');
        const tv = await database.auth.getTokenVersion(existing.id);
        const token = await signSession({ userId: existing.id, role: 'admin', tv }, session);
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
      const tv = await database.auth.getTokenVersion(created.id);
      const token = await signSession({ userId: created.id, role: 'admin', tv }, session);
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
      const tv = await database.auth.getTokenVersion(user.id);
      const token = await signSession({ userId: user.id, role, tv }, session);
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

    // POST /admin-api/auth/logout-everywhere — bump the user's token
    // version so every previously-issued JWT (including, deliberately,
    // the cookie attached to this very request) stops verifying. The
    // canonical recovery action after a credential leak: one click and
    // every device the user was signed in on is signed out.
    authLogoutEverywhere: createEndpoint(
      `${apiPath}/auth/logout-everywhere`, { method: 'POST' },
      async (ctx) => {
        const me = await currentSession(ctx);
        if (!me) { return errorResponse(401, 'not authenticated'); }
        await database.auth.bumpTokenVersion(me.userId);
        await tryAuditAuth('auth.logout', me.userId, ctx, { everywhere: true });
        return json(
          { ok: true },
          { headers: { 'set-cookie': clearSessionCookie(session) } },
        );
      },
    ),

    // POST /admin-api/auth/request-reset — generate a short-lived
    // reset token and dispatch it via `onResetRequest`. Always returns
    // 200 regardless of whether the email exists, so the response
    // can't be used as an account-enumeration oracle. The token is a
    // JWT carrying `(sub, kind: 'reset', tv)`; reset succeeds only
    // while `tv` matches the user's current token version (so a prior
    // successful reset invalidates outstanding tokens).
    authRequestReset: createEndpoint(
      `${apiPath}/auth/request-reset`, { method: 'POST' },
      async (ctx) => {
        const body = (ctx.body ?? {}) as { email?: string };
        if (!body.email) { return errorResponse(400, 'email is required'); }

        if (requestResetLimiter) {
          const ip = ipFromHeaders(ctx.getHeader);
          const blocked = await requestResetLimiter.check(`reset:${ip}:${body.email.toLowerCase()}`);
          if (blocked) { return blocked; }
        }

        // Best-effort dispatch — failures (unknown email, mailer
        // outage) are swallowed so the response is identical for valid
        // and invalid emails. The audit row logs the attempt either way.
        try {
          const user = await findUserByEmail(body.email);
          if (user) {
            const tv = await database.auth.getTokenVersion(user.id);
            const claims: ResetTokenClaims = { sub: user.id, kind: 'reset', tv };
            const token = await JWT.sign(claims, { expiresIn: RESET_TOKEN_TTL_SECONDS });
            const url = `${uiPath}/reset?token=${encodeURIComponent(token)}`;
            await onResetRequest({ email: body.email, userId: user.id, token, url });
          }
        } catch (err) {
          logger?.warn?.({ err }, '[admin] /auth/request-reset dispatch failed');
        }

        // Audit the attempt regardless. operatorId is null because the
        // caller isn't authenticated; targetId is null to avoid
        // confirming whether the email matched a row at this layer
        // (the payload echoes the attempted email so operators can
        // grep, but the targetId stays null).
        await tryAuditAuth('auth.password_reset_requested', null, ctx, { email: body.email });

        return json({ ok: true });
      },
    ),

    // POST /admin-api/auth/reset — consume a reset JWT, set a new
    // password, bump the user's tokenVersion (invalidating every
    // outstanding session AND any other reset tokens minted before
    // this call). Returns 200 on success; 400 on invalid / expired
    // tokens; 400 on too-short passwords.
    authReset: createEndpoint(
      `${apiPath}/auth/reset`, { method: 'POST' },
      async (ctx) => {
        const body = (ctx.body ?? {}) as { token?: string; password?: string };
        if (!body.token || !body.password) {
          return errorResponse(400, 'token and password are required');
        }
        if (body.password.length < minPasswordLength) {
          return errorResponse(400, `password must be at least ${minPasswordLength} characters`);
        }

        let claims: ResetTokenClaims;
        try {
          claims = await JWT.verify<ResetTokenClaims>(body.token);
        } catch {
          return errorResponse(400, 'invalid or expired reset token');
        }
        if (!claims || claims.kind !== 'reset' || !claims.sub) {
          return errorResponse(400, 'invalid reset token');
        }

        // Single-use enforcement: refuse if the user's token version
        // has moved past the value baked into this token. Happens when
        // (a) a prior reset already consumed a token for this user,
        // (b) the user signed out everywhere since requesting the
        // reset, or (c) another admin force-rotated their sessions.
        const currentTv = await database.auth.getTokenVersion(claims.sub);
        if (currentTv !== claims.tv) {
          return errorResponse(400, 'reset token has been superseded');
        }

        // Persist the new hash, then bump tokenVersion — order matters:
        // bumping first would let an attacker who races the request
        // re-sign in with the OLD password between the bump and the
        // hash update. We go through `setPasswordHash` (by id) rather
        // than `settings.onResetPassword` (by email) so the reset
        // works regardless of whether the user has an email on file.
        const hashed = await hashPassword(body.password);
        await database.auth.setPasswordHash(claims.sub, hashed);
        await database.auth.bumpTokenVersion(claims.sub);

        await tryAuditAuth('auth.password_reset_completed', claims.sub, ctx, {});

        return json({ ok: true });
      },
    ),

    // POST /admin-api/auth/register — self-serve registration.
    // Defaults to disabled — gated behind enableRegistration: true on admin.
    // (See index.ts; this endpoint is only mounted when the option is set.)
  };
}

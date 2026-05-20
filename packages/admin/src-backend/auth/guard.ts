/**
 * Better-call middleware that requires a valid admin session cookie.
 *
 * The implementation behind `admin.guard()` (the only public name —
 * mirrors `auth.middleware()`). Drop into the `use:` slot of any
 * endpoint factory — monitor(), playground(), or your own
 * createEndpoint() — to gate it behind the admin login screen:
 *
 *   import { admin } from '@colyseus/admin';
 *
 *   routes: createRouter({
 *     ...playground({ use: [admin.guard()] }),            // role 'admin'+
 *     ...monitor({    use: [admin.guard({ role: 'mod' })] }),
 *     ...admin({ database }),
 *   })
 *
 * On a missing/invalid session the guard either redirects (302 → admin login
 * with `?next=<originalUrl>`) or returns a 401 JSON body. The choice is sniffed
 * from the Accept header — browser navigations get the redirect, XHR/fetch/curl
 * get the JSON. Pass `apiOnly: true` to force 401 for every reject.
 *
 * On a valid session but insufficient role the guard redirects browser
 * navigations to the login screen while clearing the session cookie — so
 * the visitor can sign in as an account that *does* have access instead of
 * being bounced straight back through the guard (the cleared cookie is what
 * breaks that loop). XHR/fetch/curl still get a 403 JSON body.
 *
 * Bumping the user's `tokenVersion` (password reset, "sign out everywhere")
 * invalidates the guard immediately because it shares the same DB check as
 * the admin panel's own session resolver — single login screen, single
 * revocation story.
 */

import { GameDatabase, type Role } from '@colyseus/database';
import { createMiddleware } from '@colyseus/core';
import { APIError } from '@colyseus/better-call';
import { readSessionFromHeader, clearSessionCookie } from './sessions.js';

const ROLE_RANK: Record<Role, number> = { admin: 3, mod: 2, user: 1 };

export interface AdminGuardOptions {
  /** GameDatabase to validate the session against. Defaults to `GameDatabase.current`. */
  database?: GameDatabase;
  /** Minimum role required. Default 'admin'. Hierarchy: admin > mod > user. */
  role?: Role;
  /** Where to send unauthenticated browser visits. Default '/admin' (the admin UI's mount point). */
  loginUrl?: string;
  /**
   * Force JSON 401 on every reject, even for browser visits. Default false —
   * the guard sniffs the Accept header and only redirects `text/html` requests.
   */
  apiOnly?: boolean;
}

export function sessionGuard(opts: AdminGuardOptions = {}) {
  const database = opts.database ?? GameDatabase.current;
  if (!database) {
    throw new Error(
      '[admin.guard] no GameDatabase available — construct `new GameDatabase(...)` before calling admin.guard(), or pass `database:` explicitly',
    );
  }
  const requiredRole: Role = opts.role ?? 'admin';
  const loginUrl = (opts.loginUrl ?? '/admin').replace(/\/$/, '');
  const apiOnly = opts.apiOnly ?? false;

  return createMiddleware(async (ctx) => {
    const session = await readSessionFromHeader(ctx.getHeader('cookie'));
    if (!session) {
      reject(ctx, apiOnly, loginUrl, 'sign-in required');
    }

    // Token-version revocation check — mirrors makeDefaultResolver in
    // src-backend/index.ts. Sessions signed before the `tv` claim landed
    // bypass this check (backward compat).
    if (session.tv !== undefined) {
      const current = await database.auth.getTokenVersion(session.userId);
      if (current !== session.tv) {
        reject(ctx, apiOnly, loginUrl, 'session revoked');
      }
    }

    // Role check against the live DB. Matches admin's own RBAC pattern —
    // a demotion takes effect immediately without re-issuing the cookie.
    // The JWT's cached role is a stale hint we deliberately don't trust.
    const role = await database.moderation.getRole(session.userId);
    if (ROLE_RANK[role] < ROLE_RANK[requiredRole]) {
      // Include the user's *actual* role in the message so a reject on a
      // sibling app (/monitor, /playground) is self-diagnosing — the
      // typical confusion is "I can load /admin therefore I'm an admin",
      // but /admin admits mods too (with a restricted view).
      const message = `requires role '${requiredRole}' or higher (you have '${role}')`;

      // Browser navigation: bounce to the login screen so the visitor can
      // sign in as an account that *does* have access. Clearing the cookie
      // is mandatory — without it the visitor still has a valid (lower-role)
      // session, the login screen treats them as authenticated and forwards
      // straight back to `?next=`, and the guard rejects again → redirect
      // loop. Dropping the cookie forces a real re-authentication.
      if (!apiOnly && wantsHtml(ctx.getHeader('accept'))) {
        const next = currentPath(ctx);
        const qs = next ? `?next=${encodeURIComponent(next)}` : '';
        throw new APIError(
          302,
          { message },
          { location: `${loginUrl}/${qs}`, 'set-cookie': clearSessionCookie() },
        );
      }

      throw new APIError(403, { message });
    }
  });
}

/**
 * Throw an APIError that surfaces as either a 302 to the admin login
 * (browser navigation) or a 401 JSON body (everything else).
 */
function reject(
  ctx: { getHeader: (k: string) => string | null; request?: Request },
  apiOnly: boolean,
  loginUrl: string,
  message: string,
): never {
  if (!apiOnly && wantsHtml(ctx.getHeader('accept'))) {
    const next = currentPath(ctx);
    const qs = next ? `?next=${encodeURIComponent(next)}` : '';
    throw new APIError(302, { message }, { location: `${loginUrl}/${qs}` });
  }
  throw new APIError(401, { message });
}

function wantsHtml(accept: string | null): boolean {
  if (!accept) { return false; }
  // Pure `*/*` (XHR default) does not count — only an explicit text/html
  // signals a browser navigation. Best-effort heuristic, not a full parser.
  return accept.includes('text/html');
}

function currentPath(ctx: { request?: Request }): string {
  try {
    const url = new URL(ctx.request!.url);
    const candidate = url.pathname + url.search;
    return isSafePath(candidate) ? candidate : '';
  } catch {
    return '';
  }
}

/**
 * Same-origin path safety. Rejects scheme/authority leaks so a crafted
 * Accept-header + URL combination can't trick the login screen into
 * redirecting off-host.
 */
export function isSafePath(s: string): boolean {
  if (!s || s.length > 1024) { return false; }
  if (!s.startsWith('/')) { return false; }
  if (s.startsWith('//') || s.startsWith('/\\')) { return false; }
  return true;
}

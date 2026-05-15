/**
 * JWT-cookie sessions for the admin panel.
 *
 * Stateless: the JWT carries `userId` + `role` + `iat`/`exp`. No server-side
 * session store, so the admin scales horizontally without sticky-session
 * routing. The cookie is HttpOnly + SameSite=Strict + Secure (in production)
 * — XSS and CSRF surface stays small.
 *
 * Reuses @colyseus/auth's JWT class for sign/verify (same secret rotation
 * story as the rest of the framework).
 */
import { JWT } from '@colyseus/auth';

export interface AdminSession {
  /** user id from the users table */
  userId: string;
  /** cached role at session-issue time; refresh by reading moderation.getRole() if stale matters */
  role: 'admin' | 'mod' | 'user';
  /**
   * Session revocation generation. Embedded in the JWT at sign time;
   * the auth guard rejects tokens whose `tv` doesn't match the row's
   * current `tokenVersion`. Bump the row's column to invalidate all
   * prior sessions for this user — used by password reset and
   * "sign out everywhere".
   */
  tv?: number;
  /** standard JWT claims */
  iat?: number;
  exp?: number;
}

export const COOKIE_NAME = 'colyseus_admin_session';
const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 7; // 1 week

export interface SessionConfig {
  /** TTL in seconds (default 1 week). */
  ttlSeconds?: number;
  /**
   * Cookie domain. Defaults to undefined (host-only). Set explicitly when the
   * admin lives on a subdomain that should share a cookie with the API.
   */
  cookieDomain?: string;
  /** Override Secure flag. Defaults to true in production, false otherwise. */
  cookieSecure?: boolean;
  /**
   * SameSite policy. Defaults to "Strict" (best CSRF posture). Switch to "Lax"
   * if the admin lives on a different host than the auth callback.
   */
  cookieSameSite?: 'Strict' | 'Lax' | 'None';
}

export async function signSession(
  payload: Pick<AdminSession, 'userId' | 'role' | 'tv'>,
  config: SessionConfig = {},
): Promise<string> {
  const ttl = config.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  return JWT.sign(payload, { expiresIn: ttl });
}

export async function verifySession(token: string): Promise<AdminSession | null> {
  try {
    return await JWT.verify<AdminSession>(token);
  } catch {
    return null;
  }
}

/**
 * Build a Set-Cookie header string for the session cookie.
 *
 * Pass the JWT (or an empty string + maxAge: 0 to clear). The framework's
 * better-call response objects accept multiple Set-Cookie headers via the
 * standard HeadersInit shape.
 */
export function setSessionCookie(token: string, config: SessionConfig = {}): string {
  return buildCookie(COOKIE_NAME, token, {
    maxAge: config.ttlSeconds ?? DEFAULT_TTL_SECONDS,
    ...config,
  });
}

export function clearSessionCookie(config: SessionConfig = {}): string {
  return buildCookie(COOKIE_NAME, '', { maxAge: 0, ...config });
}

function buildCookie(
  name: string,
  value: string,
  opts: { maxAge: number } & SessionConfig,
): string {
  const isProd = process.env.NODE_ENV === 'production';
  const secure = opts.cookieSecure ?? isProd;
  const sameSite = opts.cookieSameSite ?? 'Strict';

  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Max-Age=${opts.maxAge}`);
  parts.push(`Path=/`);
  parts.push(`HttpOnly`);
  parts.push(`SameSite=${sameSite}`);
  if (secure) { parts.push('Secure'); }
  if (opts.cookieDomain) { parts.push(`Domain=${opts.cookieDomain}`); }
  return parts.join('; ');
}

/**
 * Parse the session cookie from the request's Cookie header. Returns null
 * if the cookie isn't present or the JWT fails to verify.
 */
export async function readSessionFromHeader(
  cookieHeader: string | null | undefined,
): Promise<AdminSession | null> {
  if (!cookieHeader) { return null; }
  const cookies = parseCookies(cookieHeader);
  const token = cookies[COOKIE_NAME];
  if (!token) { return null; }
  return verifySession(token);
}

function parseCookies(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of header.split(';')) {
    const eq = pair.indexOf('=');
    if (eq < 0) { continue; }
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (!name) { continue; }
    try { out[name] = decodeURIComponent(value); } catch { out[name] = value; }
  }
  return out;
}

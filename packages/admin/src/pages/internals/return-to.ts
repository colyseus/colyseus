/**
 * Helpers for the `?returnTo=` query-param convention used across the
 * admin panel — Edit pages, the live-room inspector, and any other
 * detail surface that wants the user to land back on the page they
 * came from after Save / Dispose / etc.
 *
 * One module so every consumer (link emitters AND link readers)
 * agrees on the encoding + same-origin guard.
 */

/**
 * Append `?returnTo=<encoded path>` to `path` when `returnTo` is set.
 * Idempotent on an empty/undefined `returnTo` (returns `path` as-is)
 * so callers don't have to branch.
 */
export function withReturnTo(path: string, returnTo?: string): string {
  return returnTo ? `${path}?returnTo=${encodeURIComponent(returnTo)}` : path;
}

/**
 * Only accept same-origin paths so a hostile `?returnTo=` value can't
 * pivot the user offsite (open-redirect class). Must start with `/`
 * and not with `//` (the protocol-relative escape hatch).
 */
export function safeReturnTo(raw: string | null, fallback: string): string {
  if (!raw) { return fallback; }
  if (!raw.startsWith('/') || raw.startsWith('//')) { return fallback; }
  return raw;
}

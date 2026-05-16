/**
 * `?next=` round-trip across the admin SPA's internal routing.
 *
 * The admin.guard() middleware on sibling apps (/monitor, /playground)
 * redirects unauthenticated browser hits to `/admin/?next=<original>`.
 * But Refine then does its own client-side routing — `<Authenticated>`
 * → SignInGate → `<Navigate to="/setup">`, or `useLogin`'s success
 * redirect to `/` — and React Router drops the query string on those
 * navigations. By the time LoginPage/SetupPage want it, it's gone.
 *
 * So we snapshot `?next=` into sessionStorage once at startup, before
 * React (and therefore Refine's router) mounts, and consume it after a
 * successful auth. sessionStorage is per-tab and survives the in-SPA
 * navigations without leaking across tabs or persisting after use.
 *
 * Everything is sanity-checked with `isSafePath` (mirrors the backend
 * guard's check) so a tampered link can't bounce the user off-host.
 */

const KEY = 'colyseus-admin-next';

export function isSafePath(s: string): boolean {
  if (!s || s.length > 1024) { return false; }
  if (!s.startsWith('/')) { return false; }
  if (s.startsWith('//') || s.startsWith('/\\')) { return false; }
  return true;
}

/**
 * Snapshot a safe `?next=` from the current URL into sessionStorage.
 * Call once, as early as possible, before Refine's router mounts. A
 * no-op when the param is absent or unsafe, so it never clobbers a
 * previously-stashed value with garbage on later navigations.
 */
export function captureNextParam(search: string = window.location.search): void {
  if (typeof window === 'undefined') { return; }
  const raw = new URLSearchParams(search).get('next') ?? '';
  if (isSafePath(raw)) {
    try { window.sessionStorage.setItem(KEY, raw); } catch { /* private mode / disabled */ }
  }
}

/**
 * Read and clear the stashed `next` path. Returns `''` when nothing was
 * stashed or it failed the safety check (treat as falsy → fall back to
 * the caller's default redirect).
 */
export function consumeNextParam(): string {
  if (typeof window === 'undefined') { return ''; }
  let value: string | null = null;
  try {
    value = window.sessionStorage.getItem(KEY);
    if (value !== null) { window.sessionStorage.removeItem(KEY); }
  } catch { /* private mode / disabled */ }
  return value && isSafePath(value) ? value : '';
}

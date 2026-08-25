/**
 * URL-safe composite primary key codec.
 *
 * Tables like cloudSaves (userId + slot) or leaderboardEntries
 * (boardId + userId + season) need their PK to ride through a single
 * `:id` URL segment. We base64url-encode JSON.stringify of the value
 * tuple — opaque-but-bulletproof for any value content (including
 * separators, whitespace, unicode).
 *
 * The same logic lives mirrored in src-backend/composite-id.ts so the
 * frontend's encoded URLs decode cleanly server-side.
 */

export function encodeCompositeId(values: ReadonlyArray<unknown>): string {
  const json = JSON.stringify(values);
  // btoa over UTF-8 — explicit because btoa rejects non-Latin-1 directly.
  const utf8 = new TextEncoder().encode(json);
  let bin = '';
  for (const b of utf8) { bin += String.fromCharCode(b); }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeCompositeId(encoded: string): unknown[] {
  let b64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) { b64 += '='; }
  const bin = atob(b64);
  const utf8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) { utf8[i] = bin.charCodeAt(i); }
  const json = new TextDecoder().decode(utf8);
  const parsed = JSON.parse(json);
  if (!Array.isArray(parsed)) {
    throw new Error('decodeCompositeId: expected an array');
  }
  return parsed;
}

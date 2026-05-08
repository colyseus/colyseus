/**
 * Server-side mirror of `src/lib/composite-id.ts`. Decodes the
 * base64url-of-JSON-array shape the frontend produces for composite-PK
 * tables (cloudSaves, leaderboardEntries, playerItems, modAssignments).
 *
 * `tryDecode` falls back to wrapping the raw id in a single-element
 * array when the input doesn't look encoded, so the same call site
 * works for both single-PK and composite-PK paths.
 */
export function decodeCompositeId(encoded: string): unknown[] {
  let b64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) { b64 += '='; }
  const json = Buffer.from(b64, 'base64').toString('utf-8');
  const parsed = JSON.parse(json);
  if (!Array.isArray(parsed)) {
    throw new Error('decodeCompositeId: expected an array');
  }
  return parsed;
}

/**
 * Decode `encoded` if the resource has multiple PK columns, otherwise
 * return a single-element array. Idempotent: callers can branch
 * uniformly on the resulting tuple.
 */
export function tryDecodeCompositeId(encoded: string, pkCols: ReadonlyArray<unknown>): unknown[] {
  if (pkCols.length <= 1) { return [encoded]; }
  return decodeCompositeId(encoded);
}

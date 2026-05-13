/**
 * Synthetic resources surfaced by `adminEndpoints` that don't live in
 * the catalog (no drizzle table backs them) but ARE referenced from
 * audit-log rows via the `resource` column.
 *
 * The dynamic `linkTo` resolver in `formatCell` consults this map when
 * a target resource isn't a real catalog entry — so audit rows
 * recorded against `resource='rooms'` deep-link to the live-room
 * inspector instead of falling back to plain text.
 *
 * Mirrors the synthetic resource names the @colyseus/admin server uses
 * for RBAC (search the backend for `ROOMS_RESOURCE` etc.). Adding a
 * new synthetic surface — e.g. a future "jobs" inspector — is a
 * one-line change here.
 */
export const SYNTHETIC_SHOW_PATHS: Record<string, (id: string) => string> = {
  rooms: (id) => `/rooms/${encodeURIComponent(id)}`,
};

export function syntheticShowPath(resource: string, id: string): string | undefined {
  const build = SYNTHETIC_SHOW_PATHS[resource];
  return build ? build(id) : undefined;
}

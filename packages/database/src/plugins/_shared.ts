/**
 * Tiny helpers shared by the database room plugins. Kept in a `_`-prefixed
 * file by convention — sorts to the top of the directory listing,
 * signaling "internal, not a plugin".
 */
import type { Client } from '@colyseus/core';

/**
 * Resolve the userId for a Colyseus client. Plugin opts can override the
 * default with a custom resolver — useful when the auth layer stores
 * user identity somewhere other than `client.userId` (e.g. `client.auth.id`).
 */
export type UserIdResolver = (client: Client) => string | null | undefined;

export const defaultUserId: UserIdResolver = (client) =>
  (client as any).userId ?? (client as any).auth?.id ?? null;

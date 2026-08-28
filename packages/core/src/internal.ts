/**
 * Framework-internal entry — symbols used by the bundled `colyseus`
 * plugins (track-user-sessions, unique-session) and the admin
 * backend, but NOT part of `@colyseus/core`'s public surface.
 *
 * Third parties should reach for `TrackUserSessionsPlugin` and its
 * `listUserSessions` static instead — the raw helpers below are
 * implementation details and can change between minor versions.
 *
 * Resolved via the `./*` wildcard in `packages/core/package.json`.
 *
 * @internal
 */
import * as matchMaker from './MatchMaker.ts';
import type { Server } from './Server.ts';
import type { Router } from './router/index.ts';
import {
  listUserSessions,
  type ListUserSessionsOptions,
  type UserSessionInfo,
} from './utils/UserSessionIndex.ts';

export {
  userRoomsKey,
  USER_ROOMS_KEY_PREFIX,
  trackUserSession,
  releaseUserSession,
  trackRoomJoin,
  releaseRoomLeave,
  sweepRoomDispose,
  listUserSessions,
  type UserRoomEntry,
  type UserSessionInfo,
  type ListUserSessionsOptions,
} from './utils/UserSessionIndex.ts';

/**
 * `listUserSessions` wired to the live `matchMaker` — what
 * `TrackUserSessionsPlugin.listUserSessions` and the admin backend
 * actually call. The pure `listUserSessions` is kept exported above
 * so unit tests can drive it with fake presence + findRooms.
 */
export function listUserSessionsLive(
  userId: string,
  options?: ListUserSessionsOptions,
): Promise<UserSessionInfo[]> {
  return listUserSessions(matchMaker.presence, matchMaker.findRoomsByIds, userId, options);
}

/**
 * Boot a server's services without listening — `colyseus/vite` owns the HTTP
 * server and never calls `Server.listen()`, so it runs this step itself.
 * Returns the finalized router, which the database may have extended.
 *
 * Pass `runBeforeListen: false` when re-booting after an HMR reload: the
 * `beforeListen` hook fires once because the server listens once, while the
 * database and the router defaults track the instances the reload rebuilt.
 */
export function prepareServices(server: Server, runBeforeListen: boolean): Promise<Router> {
  // `prepareServices` is protected — first-party hosts reach it through here
  // rather than widening the published `Server` API.
  return (server as unknown as {
    prepareServices(runBeforeListen: boolean): Promise<Router>;
  }).prepareServices(runBeforeListen);
}

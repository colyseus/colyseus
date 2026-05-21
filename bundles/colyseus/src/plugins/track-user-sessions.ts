/**
 * TrackUserSessionsPlugin — maintains the per-user reverse index in
 * Presence that powers operator tooling (admin's by-user inspector,
 * `closeUserSessions`, the `UniqueSessionPlugin`'s duplicate check,
 * any other consumer asking "which rooms is user X in right now?").
 *
 * Usage — explicit:
 *
 *   import { TrackUserSessionsPlugin } from 'colyseus/plugins/track-user-sessions';
 *
 *   class GameRoom extends Room {
 *     plugins = definePlugins({
 *       track: new TrackUserSessionsPlugin(),
 *     });
 *   }
 *
 * Usage — implicit (recommended): you don't install it yourself.
 * Plugins that need the index — like `UniqueSessionPlugin` — declare
 * it as a `static dependencies` entry, and the framework
 * auto-instantiates it at room construction. The plugin is
 * stateless and zero-config, so the auto-include is safe.
 *
 * Reading the index from your own code: call the static
 * `TrackUserSessionsPlugin.listUserSessions(userId)` — see its JSDoc
 * for the reconcile / sweep options.
 *
 * Ordering: `onJoin` runs AFTER the room's own `onJoin` so the
 * index reflects clients that survived the user-defined join hook
 * (rejected joins never make it into the index). `onLeave` and
 * `onDispose` use the default plugins-after-room order.
 */
import { RoomPlugin, type Client } from '@colyseus/core';
import {
  trackRoomJoin, releaseRoomLeave, sweepRoomDispose,
  listUserSessionsLive, type UserSessionInfo, type ListUserSessionsOptions,
} from '@colyseus/core/internal';

export type { UserSessionInfo, ListUserSessionsOptions };

export class TrackUserSessionsPlugin extends RoomPlugin {
  readonly pluginName = 'trackUserSessions' as const;

  // Match the old in-Room call sites: `trackRoomJoin` used to fire
  // AFTER the user's `onJoin` finished, so we keep the same point
  // in the lifecycle here (after-room). `onLeave` and `onDispose`
  // already default to after-room — no override needed.
  protected order = { onJoin: 'after' as const };

  protected onJoin(client: Client) { trackRoomJoin(this.room, client); }
  protected onLeave(client: Client) { releaseRoomLeave(this.room, client); }
  protected onDispose() { return sweepRoomDispose(this.room); }

  /**
   * Cluster-wide lookup: which active sessions does this user have?
   *
   * Reads from the same Presence reverse index this plugin populates.
   * Returns one `UserSessionInfo` per session (a user can be in
   * multiple rooms / multiple processes concurrently).
   *
   * By default this is a fast raw read — corrupt JSON entries are
   * dropped silently, but entries that point at rooms which have
   * since vanished (crashed process) are still returned. Pass
   * `reconcile: true` to cross-check against `matchMaker.query` and
   * drop those stale entries; the surviving entries also carry
   * `processId` from the live room record.
   *
   * Pass `removeStale: true` (only honored with `reconcile: true`)
   * to fire-and-forget `hdel` the dropped entries so the index
   * self-heals over time.
   *
   * Anonymous clients are not indexed, so an anonymous-only user
   * returns an empty array.
   */
  static listUserSessions(
    userId: string,
    options?: ListUserSessionsOptions,
  ): Promise<UserSessionInfo[]> {
    return listUserSessionsLive(userId, options);
  }
}

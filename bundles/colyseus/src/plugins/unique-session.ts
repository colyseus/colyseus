/**
 * UniqueSessionPlugin — enforces "one (or N) concurrent session(s) of
 * this room type per user." Use to prevent a player from opening
 * two tabs of the same game mode, or from re-queueing into another
 * instance while their old session is still active.
 *
 * Usage:
 *
 *   import { UniqueSessionPlugin } from 'colyseus/plugins/unique-session';
 *
 *   class GameRoom extends Room {
 *     plugins = definePlugins({
 *       unique: new UniqueSessionPlugin({ max: 1, onDuplicate: 'reject' }),
 *     });
 *   }
 *
 * The plugin reads the per-user reverse index that
 * `TrackUserSessionsPlugin` maintains in Presence. Same source the
 * admin's by-user inspector and the `closeUserSessions` helper use —
 * no new bookkeeping. (For a generic lookup from your own code,
 * prefer `TrackUserSessionsPlugin.listUserSessions(userId)`.)
 *
 * Anonymous clients (no `userId`) are NEVER rejected: with no stable
 * identity we have nothing to enforce against. Document this so
 * apps that anonymously match-make don't expect a guarantee they
 * can't get.
 *
 * Race window: two near-simultaneous joins from the same user can
 * both pass the check before either has written to the hash
 * (`trackRoomJoin` fires AFTER the plugin/room onJoin chain). For
 * the singleton/two-tabs UX this is acceptable; if your game needs
 * strict serialization, layer an atomic `hsetnx` reservation on
 * top — out of scope for v1.
 *
 * Stale-entry handling: entries are reconciled two ways. Entries
 * pointing at another room get dropped if `matchMaker.query` doesn't
 * know that room anymore (crashed process). Entries pointing at THIS
 * room get cross-checked against `this.room.clients` — if the
 * sessionId isn't live locally, the entry is treated as stale (e.g.
 * a fast disconnect that missed `onLeave`) and dropped, so a
 * legitimate fresh join isn't blocked by ghost data.
 *
 * Auto-includes `TrackUserSessionsPlugin` via `static dependencies`
 * so the per-user reverse index this plugin reads from is always
 * populated — apps don't have to register the tracker plugin
 * themselves.
 */
import {
  RoomPlugin, ServerError, matchMaker,
  type Client, type Room, type IRoomCache, type PluginDependencies,
} from '@colyseus/core';
import { userRoomsKey, type UserRoomEntry, type UserSessionInfo } from '@colyseus/core/internal';
import { TrackUserSessionsPlugin } from './track-user-sessions.ts';

/**
 * Per-existing-session context passed to the `conflictsWith`
 * predicate. The full matchmaker `IRoomCache` (including `metadata`)
 * is attached for cross-room entries — populated from the same
 * batch lookup the plugin already runs, so no extra wire ops.
 *
 * For entries that point at the CURRENT room (same `Room` instance
 * the plugin is attached to), `room` is `undefined` — read from
 * the second arg (`currentRoom`) instead, which is the live `Room`.
 */
export interface UniqueSessionConflict {
  /** The existing session's id. */
  sessionId: string;
  /** Unix ms timestamp recorded when the existing session joined. */
  joinedAt: number;
  /** Matchmaker's cached `IRoomCache` for the existing session's
   *  room — `metadata`, `clients`, `locked`, etc. Undefined when the
   *  existing session is in the same room instance as the joining
   *  client; use `currentRoom` for that case. */
  room?: IRoomCache;
}

export interface UniqueSessionOptions {
  /**
   * Max concurrent sessions of this room type per user. Default `1`
   * (strict singleton). Setting `> 1` lets users open e.g. two tabs
   * but not ten — useful for testing/spectating workflows.
   */
  max?: number;

  /**
   * Behavior when the limit is exceeded:
   *  - `'reject'` (default): refuse the new join with a `ServerError`.
   *  - `'replace'`: kick the oldest existing session(s) so the new
   *    join can proceed. Useful for refresh-style UX where a player
   *    expects their newer tab to "win".
   */
  onDuplicate?: 'reject' | 'replace';

  /**
   * Error code attached to the `ServerError` thrown on reject. The
   * SDK surfaces this as `MatchMakeError.code`. Default `4400`
   * (matches the 4xxx custom range Colyseus uses elsewhere).
   */
  rejectCode?: number;

  /**
   * Message attached to the `ServerError` thrown on reject. Default
   * `'already_in_room'`. The SDK exposes it as `e.message` so the
   * client can branch on it.
   */
  rejectMessage?: string;

  /**
   * Per-existing-session filter applied after the plugin's own
   * same-`roomName` matching + stale-entry reconcile, but before
   * counting against `max`. Return `true` to count the existing
   * session as a conflict, `false` to skip it.
   *
   * Receives:
   *  - `existing` — `{ sessionId, joinedAt, room? }`. The `room`
   *    field is the matchmaker's cached `IRoomCache` for the
   *    existing session's room (carrying `metadata`, `clients`,
   *    `locked`, etc.), populated for cross-room entries from the
   *    same batch lookup the plugin already runs. It is `undefined`
   *    when the existing session is in the SAME `Room` instance as
   *    the joining client — for those, read state from `currentRoom`.
   *  - `currentRoom` — the live `Room` instance the join is targeting
   *    (i.e. `this.room` inside the plugin).
   *
   * Use this for metadata-based scoping (e.g. "only count
   * same-game-mode sessions"), per-process exemptions (multi-region
   * deploys), capacity-aware filtering ("don't count rooms that are
   * already full"), etc.
   */
  conflictsWith?: (
    existing: UniqueSessionConflict,
    currentRoom: Room,
  ) => boolean;

  /**
   * Extract the user's stable id from `Client`. Return a non-empty
   * string when the client carries an identity; return `undefined`
   * (or empty string) for anonymous clients — the plugin skips the
   * check in that case.
   *
   * Default reads `client.auth.id`, then `client.auth.userId` — the
   * JWT payload shape `@colyseus/auth`'s default `onAuth` produces
   * for both authenticated AND anonymously-registered sessions
   * (anonymous users from `registerAnonymous` get an `id` too;
   * `anonymousId` is a separate upgrade-token field).
   *
   * Custom auth flows that store the id elsewhere (e.g.
   * `client.auth.profile.sub` for raw OIDC) override with a
   * function that returns from that path.
   */
  resolveUserId?: (client: Client) => string | undefined;
}

/** Default extractor — `auth.id`, then `auth.userId`. */
function defaultResolveUserId(client: Client): string | undefined {
  const auth = (client as any).auth;
  if (!auth) { return undefined; }
  if (typeof auth.id === 'string' && auth.id.length > 0) { return auth.id; }
  if (typeof auth.userId === 'string' && auth.userId.length > 0) { return auth.userId; }
  return undefined;
}

/**
 * Result of evaluating the user's existing sessions. Extracted from
 * the `onJoin` body so the unit tests can drive it in isolation.
 */
interface ConflictResult {
  /** Entries that should count against the limit. */
  conflicts: UserSessionInfo[];
  /** Session ids that point at rooms which no longer exist —
   *  best-effort hdel'd so the next check doesn't re-pay the cost. */
  staleSessions: string[];
}

export class UniqueSessionPlugin extends RoomPlugin {
  readonly pluginName = 'uniqueSession' as const;

  static dependencies: PluginDependencies = [TrackUserSessionsPlugin];

  private max: number;
  private mode: 'reject' | 'replace';
  private rejectCode: number;
  private rejectMessage: string;
  private conflictsWith?: (
    existing: UniqueSessionConflict,
    currentRoom: Room,
  ) => boolean;
  private resolveUserId: (client: Client) => string | undefined;

  constructor(opts: UniqueSessionOptions = {}) {
    super();
    this.max = opts.max ?? 1;
    this.mode = opts.onDuplicate ?? 'reject';
    this.rejectCode = opts.rejectCode ?? 4400;
    this.rejectMessage = opts.rejectMessage ?? 'already_in_room';
    this.conflictsWith = opts.conflictsWith;
    this.resolveUserId = opts.resolveUserId ?? defaultResolveUserId;
  }

  protected async onJoin(client: Client): Promise<void> {
    const userId = this.resolveUserId(client);
    // Anonymous clients have no stable identity — nothing to enforce
    // against. Skipping (rather than rejecting) keeps anonymous
    // matchmaking working unchanged.
    if (!userId) { return; }

    const { conflicts, staleSessions } = await this.evaluate(userId);

    // Best-effort cleanup of stale entries — don't block the response
    // on it (the user-visible answer doesn't depend on hdel landing).
    if (staleSessions.length > 0) {
      const key = userRoomsKey(userId);
      void Promise.all(
        staleSessions.map((s) => matchMaker.presence.hdel(key, s)),
      ).catch(() => { /* ignore */ });
    }

    if (conflicts.length < this.max) { return; }

    if (this.mode === 'replace') {
      // Kick the *oldest* conflicts first so the newest existing
      // session survives alongside the new one (or the new one wins
      // outright when max=1). Sort by joinedAt ascending — earliest
      // join time is oldest.
      const sorted = conflicts.slice().sort((a, b) => a.joinedAt - b.joinedAt);
      const toKick = sorted.slice(0, conflicts.length - this.max + 1);
      await Promise.all(
        toKick.map((info) =>
          matchMaker.remoteRoomCall(
            info.roomId,
            'kickClient' as any,
            [info.sessionId, 1000, 'replaced'],
          ).catch(() => { /* room gone — that's fine, the conflict resolves either way */ }),
        ),
      );
      return;
    }

    // 'reject' — throw so the framework refuses the join. The thrown
    // ServerError surfaces to the SDK as `MatchMakeError`.
    throw new ServerError(this.rejectCode, this.rejectMessage);
  }

  /**
   * Read the user's session index, parse + reconcile entries against
   * live rooms, return the conflict list. Exposed so unit tests can
   * exercise the parsing/reconciliation logic without standing up
   * the full plugin lifecycle.
   *
   * Wire-op cap: 2 per call — one HGETALL for the user's hash, plus
   * one batch lookup for cross-room candidates (skipped when none).
   * Self-room entries are resolved against `this.room.clients`
   * locally and never touch the matchmaker.
   */
  async evaluate(userId: string): Promise<ConflictResult> {
    // Wire op 1: read user's session hash.
    const raw = await matchMaker.presence.hgetall(userRoomsKey(userId));
    const fields = Object.keys(raw);
    if (fields.length === 0) { return { conflicts: [], staleSessions: [] }; }

    const staleSessions: string[] = [];
    const selfRoomConflicts: UserSessionInfo[] = [];
    const crossRoomEntries: Array<{ sessionId: string; entry: UserRoomEntry }> = [];

    // Stage 1: classify entries in-memory. No matchmaker calls.
    //   - corrupt JSON → stale
    //   - wrong roomName → ignored
    //   - this.room.roomId → resolved via local clients
    //   - cross-room → deferred to the batch lookup below
    for (const sessionId of fields) {
      let entry: UserRoomEntry;
      try { entry = JSON.parse(raw[sessionId]); }
      catch {
        staleSessions.push(sessionId);
        continue;
      }

      if (entry.roomName !== this.room.roomName) { continue; }

      if (entry.roomId === this.room.roomId) {
        // Local clients are the authoritative source for "is this
        // sessionId still active in our room?" — an entry without a
        // live client is a leftover from a connection whose onLeave
        // never ran (TCP reset, fast disconnect). Drop it so a
        // legitimate fresh join isn't rejected by ghost data.
        const stillHere = this.room.clients?.some(
          (c: any) => c.sessionId === sessionId,
        ) ?? false;
        if (stillHere) {
          selfRoomConflicts.push({ sessionId, ...entry });
        } else {
          staleSessions.push(sessionId);
        }
      } else {
        crossRoomEntries.push({ sessionId, entry });
      }
    }

    // Wire op 2 (skipped when no cross-room candidates): one batch
    // lookup verifies that each cross-room candidate's roomId still
    // exists in the matchmaker. Bounded at K cross-room entries for
    // *this* user — never the cluster size.
    const live = crossRoomEntries.length > 0
      ? await matchMaker.findRoomsByIds(crossRoomEntries.map((c) => c.entry.roomId))
      : new Map();

    const conflicts: UserSessionInfo[] = [...selfRoomConflicts];
    for (const { sessionId, entry } of crossRoomEntries) {
      const room = live.get(entry.roomId);
      if (!room) {
        // Cross-room entry pointing at a roomId the matchmaker no
        // longer knows about — index drift from a crashed process.
        staleSessions.push(sessionId);
        continue;
      }
      const info: UserSessionInfo = { sessionId, ...entry };
      if (room.processId !== undefined) { info.processId = room.processId; }
      conflicts.push(info);
    }

    // `live.get(c.roomId)` is undefined for self-room conflicts (we
    // never put them in `live`) and the cross-room `IRoomCache` for
    // the rest — exactly the predicate's contract.
    const filtered = this.conflictsWith
      ? conflicts.filter((c) => this.conflictsWith!({
          sessionId: c.sessionId,
          joinedAt: c.joinedAt,
          room: live.get(c.roomId),
        }, this.room))
      : conflicts;
    return { conflicts: filtered, staleSessions };
  }

}

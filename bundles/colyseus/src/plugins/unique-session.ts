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
 * The plugin reads the per-user reverse index that Room maintains in
 * Presence (`userRoomsKey(userId)` → hash of `{ roomId, roomName,
 * joinedAt }` per sessionId). Same source the admin's by-user
 * inspector and the new `closeUserSessions` helper use — no new
 * bookkeeping.
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
  RoomPlugin, ServerError, matchMaker, userRoomsKey,
  type Client, type UserRoomEntry, type PluginDependencies,
} from '@colyseus/core';
import { TrackUserSessionsPlugin } from './track-user-sessions.ts';

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
   * Predicate to scope the check more narrowly than "same roomName".
   * Receives each existing entry the user has in Presence; return
   * `true` when the entry should count against the limit.
   *
   * Default: every entry whose `roomName` matches the current room
   * is counted. Use this to scope by metadata, e.g.
   * `(entry) => roomNameMatches && metadata.gameMode === current.gameMode`.
   *
   * Note: the predicate only sees `roomId / roomName / joinedAt`
   * (what the reverse index stores). If you need richer matching,
   * fetch the room's metadata yourself via `matchMaker.query`.
   */
  conflictsWith?: (entry: UserRoomEntry) => boolean;

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
  /** Entries that should count against the limit, with their session ids. */
  conflicts: Array<{ sessionId: string; entry: UserRoomEntry }>;
  /** Session ids that point at rooms which no longer exist —
   *  best-effort hdel'd so the next check doesn't re-pay the cost. */
  stragglers: string[];
}

export class UniqueSessionPlugin extends RoomPlugin {
  readonly pluginName = 'uniqueSession' as const;

  static dependencies: PluginDependencies = [TrackUserSessionsPlugin];

  private max: number;
  private mode: 'reject' | 'replace';
  private rejectCode: number;
  private rejectMessage: string;
  private conflictsWith?: (entry: UserRoomEntry) => boolean;
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

    const { conflicts, stragglers } = await this.evaluate(userId);

    // Best-effort cleanup of stale entries — don't block the response
    // on it (the user-visible answer doesn't depend on hdel landing).
    if (stragglers.length > 0) {
      const key = userRoomsKey(userId);
      void Promise.all(
        stragglers.map((s) => matchMaker.presence.hdel(key, s)),
      ).catch(() => { /* ignore */ });
    }

    if (conflicts.length < this.max) { return; }

    if (this.mode === 'replace') {
      // Kick the *oldest* conflicts first so the newest existing
      // session survives alongside the new one (or the new one wins
      // outright when max=1). Sort by joinedAt ascending — earliest
      // join time is oldest.
      const sorted = conflicts.slice().sort((a, b) => a.entry.joinedAt - b.entry.joinedAt);
      const toKick = sorted.slice(0, conflicts.length - this.max + 1);
      await Promise.all(
        toKick.map(({ sessionId, entry }) =>
          matchMaker.remoteRoomCall(
            entry.roomId,
            'kickClient' as any,
            [sessionId, 1000, 'replaced'],
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
   */
  async evaluate(userId: string): Promise<ConflictResult> {
    const raw = await matchMaker.presence.hgetall(userRoomsKey(userId));
    const fields = Object.keys(raw);
    if (fields.length === 0) { return { conflicts: [], stragglers: [] }; }

    // Build a fast lookup of live rooms — O(entries) reconciliation.
    const live = new Map<string, any>();
    for (const r of (await matchMaker.query({})) as any[]) {
      live.set(r.roomId, r);
    }

    const conflicts: ConflictResult['conflicts'] = [];
    const stragglers: string[] = [];

    for (const sessionId of fields) {
      let entry: UserRoomEntry;
      try {
        entry = JSON.parse(raw[sessionId]);
      } catch {
        // Corrupt index entry — drop it.
        stragglers.push(sessionId);
        continue;
      }

      if (entry.roomName !== this.room.roomName) { continue; }

      if (entry.roomId === this.room.roomId) {
        // The entry points at THIS room instance. Two sub-cases:
        //  - sessionId is still in our local `clients` ⇒ a real
        //    concurrent session in the same room (count it).
        //  - sessionId is NOT in `clients` ⇒ stale entry left by
        //    a previous connection whose `onLeave` didn't run
        //    (TCP reset, fast disconnect). Drop it so a legitimate
        //    fresh join isn't rejected by ghost data.
        const stillHere = this.room.clients?.some(
          (c: any) => c.sessionId === sessionId,
        ) ?? false;
        if (!stillHere) {
          stragglers.push(sessionId);
          continue;
        }
        // Fall through into the conflict-count block below.
      } else if (!live.has(entry.roomId)) {
        // Cross-room entry pointing at a room the matchmaker no
        // longer knows about — index drift from a crashed process.
        stragglers.push(sessionId);
        continue;
      }

      if (this.conflictsWith && !this.conflictsWith(entry)) { continue; }

      conflicts.push({ sessionId, entry });
    }

    return { conflicts, stragglers };
  }

}

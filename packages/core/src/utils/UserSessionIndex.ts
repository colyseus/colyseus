/**
 * User → active sessions index: "which active rooms is user X in?"
 *
 * Without this, answering that question would require fanning out
 * `getInspectorView()` across every running room — O(rooms) per lookup.
 * Instead, each Room writes a small Presence hash entry on `_onJoin` and
 * removes it on `_onAfterLeave` / dispose. The admin endpoint reads the
 * hash with a single `hgetall`, then reconciles against the matchmaker's
 * live room listing to drop stale entries left behind by hard crashes
 * (no `onLeave` ran).
 *
 * Hash schema:
 *   key:   colyseus:user-rooms:{userId}
 *   field: sessionId
 *   value: JSON `{ roomId, roomName, joinedAt }` (joinedAt is unix ms)
 *
 * Anonymous clients (no userId resolvable) are skipped — the index is
 * for forensic / support workflows, not anonymous traffic. A Room can
 * also opt out wholesale by setting `trackUserSessions = false` (e.g.
 * a high-volume relay room that doesn't want to pay the Presence
 * write per join).
 *
 * Per-Room state (which sessionIds have an entry, and under which userId)
 * lives in a module-level WeakMap rather than as a field on Room itself.
 * Two reasons:
 *
 *   1. Room.ts stays thin — it only knows about three call points
 *      (`trackRoomJoin`, `releaseRoomLeave`, `sweepRoomDispose`) and
 *      doesn't have to carry an extra Map field or two private helper
 *      methods solely for this concern.
 *   2. The WeakMap is GC-tied to the Room — when a Room instance is
 *      collected, its entries vanish automatically. No explicit teardown
 *      hook needed beyond the dispose sweep that drains Presence.
 *
 * @internal
 */
import type { Presence } from '../presence/Presence.ts';

export const USER_ROOMS_KEY_PREFIX = 'colyseus:user-rooms:';

export function userRoomsKey(userId: string): string {
  return USER_ROOMS_KEY_PREFIX + userId;
}

/**
 * What's serialized into the Presence hash value (sessionId is the
 * hash field key, not part of the body). Internal write-side shape.
 */
export interface UserRoomEntry {
  roomId: string;
  roomName: string;
  joinedAt: number;
}

/**
 * Public read-side shape returned by `listUserSessions`: a parsed
 * `UserRoomEntry` plus its sessionId, optionally enriched with
 * `processId` when reconcile against the matchmaker was on.
 */
export interface UserSessionInfo extends UserRoomEntry {
  sessionId: string;
  /**
   * Process hosting the room, per the matchmaker. Populated only
   * when `listUserSessions` was called with `reconcile: true` AND
   * the room is still in the matchmaker roster.
   */
  processId?: string;
}

/**
 * Structural subset of `Room` needed by the index. Lets this module
 * avoid importing `Room` (which would create a cycle) while still
 * staying typed at the call site.
 */
interface InspectorRoomShape {
  roomId: string;
  roomName: string;
  presence: Presence;
}

/**
 * Structural subset of a Client we read at join/leave. `userId` and
 * `auth` are both optional — the index simply skips clients without
 * either, which is the correct "anonymous traffic doesn't show up
 * in support tooling" behavior.
 */
interface InspectorClientShape {
  sessionId: string;
  userId?: string;
  auth?: { id?: string } | null;
}

/**
 * sessionId → userId for clients currently registered in the index,
 * scoped per Room. WeakMap-keyed so a forgotten Room takes its tracking
 * map with it.
 */
const tracked = new WeakMap<InspectorRoomShape, Map<string, string>>();

function getTrackingMap(room: InspectorRoomShape): Map<string, string> {
  let map = tracked.get(room);
  if (!map) {
    map = new Map();
    tracked.set(room, map);
  }
  return map;
}

function resolveUserId(client: InspectorClientShape): string | undefined {
  return client.userId ?? client.auth?.id;
}

/**
 * Best-effort: write the join entry. Errors are swallowed because the
 * index is observability metadata — a Presence outage shouldn't reject
 * a player's join. Exposed as a pure helper for tests + the admin
 * endpoint; `trackRoomJoin` is the Room-flavored entrypoint.
 */
export async function trackUserSession(
  presence: Presence,
  userId: string,
  sessionId: string,
  entry: UserRoomEntry,
): Promise<void> {
  try {
    await presence.hset(userRoomsKey(userId), sessionId, JSON.stringify(entry));
  } catch {
    // intentional: see fn-doc
  }
}

/**
 * Best-effort: remove the join entry. Errors are swallowed so a Presence
 * blip doesn't bubble into `_onAfterLeave` / `_dispose`.
 */
export async function releaseUserSession(
  presence: Presence,
  userId: string,
  sessionId: string,
): Promise<void> {
  try {
    await presence.hdel(userRoomsKey(userId), sessionId);
  } catch {
    // intentional: see fn-doc
  }
}

/**
 * Record `client`'s join under `room` in the reverse index. No-op for
 * clients with no resolvable userId (anonymous), and when the room
 * carries no presence (shouldn't happen — defensive for unit tests).
 *
 * Fire-and-forget against Presence; the in-memory tracking map updates
 * synchronously so a follow-up `releaseRoomLeave` always finds the
 * right userId even if the Presence write is still in flight.
 */
export function trackRoomJoin(room: InspectorRoomShape, client: InspectorClientShape): void {
  if (!room.presence) { return; }
  const userId = resolveUserId(client);
  if (!userId) { return; }
  getTrackingMap(room).set(client.sessionId, userId);
  const entry: UserRoomEntry = {
    roomId: room.roomId,
    roomName: room.roomName,
    joinedAt: Date.now(),
  };
  void trackUserSession(room.presence, userId, client.sessionId, entry);
}

/**
 * Drop `client`'s entry from the reverse index. Idempotent — no-op
 * when the client wasn't tracked (anonymous, or tracking failed at
 * join time).
 */
export function releaseRoomLeave(room: InspectorRoomShape, client: InspectorClientShape): void {
  if (!room.presence) { return; }
  const map = tracked.get(room);
  const userId = map?.get(client.sessionId);
  if (!userId || !map) { return; }
  map.delete(client.sessionId);
  void releaseUserSession(room.presence, userId, client.sessionId);
}

/**
 * Sweep any still-tracked sessions for `room`. Called during dispose to
 * cover the case where `disconnect()` races the per-client `_onAfterLeave`
 * path — the read-side reconcile handles cross-process crash recovery,
 * but this is the cheap deterministic cleanup for a clean local dispose.
 *
 * Awaits the pending `hdel`s so the caller can sequence against "the
 * index is now coherent" — the dispose path uses that ordering.
 */
export async function sweepRoomDispose(room: InspectorRoomShape): Promise<void> {
  if (!room.presence) { return; }
  const map = tracked.get(room);
  if (!map || map.size === 0) { return; }
  const pending: Promise<void>[] = [];
  for (const [sessionId, userId] of map) {
    pending.push(releaseUserSession(room.presence, userId, sessionId));
  }
  map.clear();
  await Promise.all(pending);
}

/**
 * Minimal shape of a matchmaker room record needed for reconcile —
 * keeps this module decoupled from the matchmaker / driver types.
 * `matchMaker.query()`'s actual return (`IRoomCache[]`) is structurally
 * a supertype of this, so callers can pass `matchMaker.query` directly.
 */
interface MatchmakerRoomLike {
  roomId: string;
  processId?: string;
}

export interface ListUserSessionsOptions {
  /**
   * Drop entries whose `roomId` is no longer in the matchmaker roster
   * (the index can lag a crashed process). When `true`, the returned
   * entries also carry `processId` from the live room record.
   *
   * Off by default — most callers (kick everyone, count) don't need it
   * and the extra `matchMaker.query` round-trip isn't free.
   */
  reconcile?: boolean;

  /**
   * Fire-and-forget `hdel` for stale entries — those dropped by
   * reconcile (matchmaker doesn't know the room anymore) plus any
   * with corrupt JSON. Lets read endpoints self-heal the index on
   * each call. No-op when `reconcile` is `false`.
   */
  removeStale?: boolean;
}

/**
 * Read the user → active sessions index. Pure helper — the
 * `Presence` + matchmaker batch lookup are injected so this module
 * stays free of matchmaker imports (and so unit tests can drive it
 * with fake deps).
 *
 * Wire-op count per call:
 *   - 1 HGETALL on the user's hash (always).
 *   - 1 batch room lookup when `reconcile: true` AND there are
 *     entries to verify; skipped otherwise.
 *
 * Bounded at 2 wire ops regardless of the user's session count.
 */
export async function listUserSessions(
  presence: Presence,
  findRooms: (roomIds: string[]) => Promise<Map<string, MatchmakerRoomLike>>,
  userId: string,
  options: ListUserSessionsOptions = {},
): Promise<UserSessionInfo[]> {
  const reconcile = options.reconcile === true;
  const removeStale = reconcile && options.removeStale === true;

  let raw: Record<string, string>;
  try {
    raw = await presence.hgetall(userRoomsKey(userId));
  } catch {
    // Presence outage — observability shouldn't bring down the caller.
    return [];
  }
  const fields = Object.keys(raw);
  if (fields.length === 0) { return []; }

  const staleSessions: string[] = [];
  const parsed: Array<{ sessionId: string; entry: UserRoomEntry }> = [];
  for (const sessionId of fields) {
    try {
      parsed.push({ sessionId, entry: JSON.parse(raw[sessionId]) as UserRoomEntry });
    } catch {
      // Corrupt JSON — index drift. Removable even without reconcile.
      staleSessions.push(sessionId);
    }
  }

  if (!reconcile) {
    return parsed.map(({ sessionId, entry }) => ({ sessionId, ...entry }));
  }

  // One batch lookup for the K roomIds we care about. K = entries
  // surviving the JSON.parse stage, not cluster size.
  const live = parsed.length > 0
    ? await findRooms(parsed.map((p) => p.entry.roomId))
    : new Map<string, MatchmakerRoomLike>();

  const result: UserSessionInfo[] = [];
  for (const { sessionId, entry } of parsed) {
    const room = live.get(entry.roomId);
    if (!room) {
      // Matchmaker doesn't know this roomId anymore — stale entry
      // from a crashed process. Drop it (and remove if requested).
      staleSessions.push(sessionId);
      continue;
    }
    const info: UserSessionInfo = { sessionId, ...entry };
    if (room.processId !== undefined) { info.processId = room.processId; }
    result.push(info);
  }

  if (removeStale && staleSessions.length > 0) {
    const key = userRoomsKey(userId);
    void Promise.all(
      staleSessions.map((s) => presence.hdel(key, s)),
    ).catch(() => { /* presence outage, swallow */ });
  }

  return result;
}

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

export interface UserRoomEntry {
  roomId: string;
  roomName: string;
  joinedAt: number;
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

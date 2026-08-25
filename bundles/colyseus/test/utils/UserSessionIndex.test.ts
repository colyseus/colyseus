/**
 * Unit tests for the Presence-backed user→rooms reverse index used by
 * the admin "Active rooms" tab. Exercises the pure helper boundary so
 * the test doesn't need to spin up a full Server / WebSocket transport —
 * the Room-side integration is covered indirectly by the wider suite
 * exercising onJoin / onLeave (any regression there shows up in the
 * 347-test bundle run).
 */
import assert from 'assert';
import { LocalPresence, LocalDriver } from '@colyseus/core';
import {
  userRoomsKey,
  trackUserSession,
  releaseUserSession,
  listUserSessions,
  type UserRoomEntry,
} from '@colyseus/core/internal';

describe('UserSessionIndex (user → active rooms reverse index)', () => {
  it('builds a stable, namespaced presence key per userId', () => {
    assert.strictEqual(userRoomsKey('u1'), 'colyseus:user-rooms:u1');
    assert.notStrictEqual(userRoomsKey('u1'), userRoomsKey('u2'));
  });

  it('round-trips a session entry through hset/hgetall/hdel', async () => {
    const presence = new LocalPresence();
    const entry: UserRoomEntry = { roomId: 'r1', roomName: 'lobby', joinedAt: 100 };
    await trackUserSession(presence, 'u1', 's1', entry);

    const raw = await presence.hgetall(userRoomsKey('u1'));
    assert.deepStrictEqual(Object.keys(raw), ['s1']);
    assert.deepStrictEqual(JSON.parse(raw.s1!), entry);

    await releaseUserSession(presence, 'u1', 's1');
    const after = await presence.hgetall(userRoomsKey('u1'));
    assert.deepStrictEqual(after, {});
  });

  it('multiple sessions for the same user coexist under one hash key', async () => {
    const presence = new LocalPresence();
    await trackUserSession(presence, 'u1', 'sA', { roomId: 'r1', roomName: 'a', joinedAt: 1 });
    await trackUserSession(presence, 'u1', 'sB', { roomId: 'r2', roomName: 'b', joinedAt: 2 });

    const raw = await presence.hgetall(userRoomsKey('u1'));
    assert.deepStrictEqual(Object.keys(raw).sort(), ['sA', 'sB']);

    // Releasing one leaves the other in place — important for the
    // multi-window / multi-room support flow.
    await releaseUserSession(presence, 'u1', 'sA');
    const after = await presence.hgetall(userRoomsKey('u1'));
    assert.deepStrictEqual(Object.keys(after), ['sB']);
  });

  it('different users do not collide on the same sessionId', async () => {
    const presence = new LocalPresence();
    await trackUserSession(presence, 'u1', 'sX', { roomId: 'r1', roomName: 'r', joinedAt: 1 });
    await trackUserSession(presence, 'u2', 'sX', { roomId: 'r2', roomName: 'r', joinedAt: 2 });

    const u1 = await presence.hgetall(userRoomsKey('u1'));
    const u2 = await presence.hgetall(userRoomsKey('u2'));
    assert.strictEqual(JSON.parse(u1.sX!).roomId, 'r1');
    assert.strictEqual(JSON.parse(u2.sX!).roomId, 'r2');
  });

  it('release on a missing field is a silent no-op', async () => {
    const presence = new LocalPresence();
    // Should not throw even though the field was never written.
    await releaseUserSession(presence, 'u-absent', 's-absent');
    const raw = await presence.hgetall(userRoomsKey('u-absent'));
    assert.deepStrictEqual(raw, {});
  });
});

describe('listUserSessions', () => {
  const noRooms = async () => new Map();
  const roomsFrom = (records: Array<{ roomId: string; processId?: string }>) =>
    async (ids: string[]) => {
      const m = new Map<string, { roomId: string; processId?: string }>();
      for (const r of records) { if (ids.includes(r.roomId)) m.set(r.roomId, r); }
      return m;
    };

  it('returns an empty array when the user has no entries', async () => {
    const presence = new LocalPresence();
    const result = await listUserSessions(presence, noRooms, 'u-absent');
    assert.deepStrictEqual(result, []);
  });

  it('returns one info-per-session in raw mode (no reconcile)', async () => {
    const presence = new LocalPresence();
    await trackUserSession(presence, 'u1', 'sA', { roomId: 'r1', roomName: 'lobby', joinedAt: 10 });
    await trackUserSession(presence, 'u1', 'sB', { roomId: 'r2', roomName: 'lobby', joinedAt: 20 });
    // No reconcile ⇒ both entries returned even though `noRooms` says
    // no rooms exist. No `processId` enrichment.
    const result = await listUserSessions(presence, noRooms, 'u1');
    const byId = Object.fromEntries(result.map((r) => [r.sessionId, r]));
    assert.deepStrictEqual(byId.sA, { sessionId: 'sA', roomId: 'r1', roomName: 'lobby', joinedAt: 10 });
    assert.deepStrictEqual(byId.sB, { sessionId: 'sB', roomId: 'r2', roomName: 'lobby', joinedAt: 20 });
  });

  it('reconcile drops entries whose room is no longer in matchmaker', async () => {
    const presence = new LocalPresence();
    await trackUserSession(presence, 'u1', 's-live', { roomId: 'r-live', roomName: 'a', joinedAt: 1 });
    await trackUserSession(presence, 'u1', 's-dead', { roomId: 'r-dead', roomName: 'a', joinedAt: 2 });
    const findRooms = roomsFrom([{ roomId: 'r-live', processId: 'p7' }]);

    const result = await listUserSessions(presence, findRooms, 'u1', { reconcile: true });
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].sessionId, 's-live');
    assert.strictEqual(result[0].processId, 'p7');

    // Without removeStale, the dead entry stays in Presence.
    const raw = await presence.hgetall(userRoomsKey('u1'));
    assert.deepStrictEqual(Object.keys(raw).sort(), ['s-dead', 's-live']);
  });

  it('removeStale hdels dropped entries (fire-and-forget)', async () => {
    const presence = new LocalPresence();
    await trackUserSession(presence, 'u1', 's-live', { roomId: 'r-live', roomName: 'a', joinedAt: 1 });
    await trackUserSession(presence, 'u1', 's-dead', { roomId: 'r-dead', roomName: 'a', joinedAt: 2 });
    const findRooms = roomsFrom([{ roomId: 'r-live' }]);

    await listUserSessions(presence, findRooms, 'u1', { reconcile: true, removeStale: true });
    // The fire-and-forget hdel is microtask-bound on LocalPresence —
    // a single tick is enough to let it settle.
    await new Promise((r) => setImmediate(r));

    const raw = await presence.hgetall(userRoomsKey('u1'));
    assert.deepStrictEqual(Object.keys(raw), ['s-live']);
  });

  it('drops corrupt JSON entries silently', async () => {
    const presence = new LocalPresence();
    await trackUserSession(presence, 'u1', 's-ok', { roomId: 'r1', roomName: 'a', joinedAt: 1 });
    // Write an entry with malformed JSON directly.
    await presence.hset(userRoomsKey('u1'), 's-corrupt', '{not json');

    const raw = await listUserSessions(presence, noRooms, 'u1');
    assert.strictEqual(raw.length, 1);
    assert.strictEqual(raw[0].sessionId, 's-ok');
  });

  it('asks findRooms for only the user\'s K roomIds — never the cluster', async () => {
    const presence = new LocalPresence();
    await trackUserSession(presence, 'u1', 'sA', { roomId: 'r1', roomName: 'a', joinedAt: 1 });
    await trackUserSession(presence, 'u1', 'sB', { roomId: 'r2', roomName: 'a', joinedAt: 2 });

    let calledWith: string[] = [];
    const findRooms = async (ids: string[]) => {
      calledWith = ids;
      return new Map([['r1', { roomId: 'r1' }], ['r2', { roomId: 'r2' }]]);
    };

    await listUserSessions(presence, findRooms, 'u1', { reconcile: true });
    assert.deepStrictEqual(calledWith.sort(), ['r1', 'r2']);
  });
});

describe('LocalDriver.findByIds', () => {
  it('returns a Map keyed by roomId for the rooms that exist', async () => {
    const d = new LocalDriver();
    d.rooms = [
      { roomId: 'r1', processId: 'p1', name: 'a', clients: 0, maxClients: 8 },
      { roomId: 'r2', processId: 'p2', name: 'a', clients: 0, maxClients: 8 },
      { roomId: 'r3', processId: 'p1', name: 'b', clients: 0, maxClients: 8 },
    ];
    const result = await d.findByIds(['r1', 'r3', 'r-missing']);
    assert.strictEqual(result.size, 2);
    assert.strictEqual(result.get('r1')?.processId, 'p1');
    assert.strictEqual(result.get('r3')?.processId, 'p1');
    assert.strictEqual(result.has('r-missing'), false);
  });

  it('returns an empty Map for an empty input', async () => {
    const d = new LocalDriver();
    d.rooms = [{ roomId: 'r1', processId: 'p1', name: 'a', clients: 0, maxClients: 8 }];
    const result = await d.findByIds([]);
    assert.strictEqual(result.size, 0);
  });
});

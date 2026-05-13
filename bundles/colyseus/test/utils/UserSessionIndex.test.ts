/**
 * Unit tests for the Presence-backed user→rooms reverse index used by
 * the admin "Active rooms" tab. Exercises the pure helper boundary so
 * the test doesn't need to spin up a full Server / WebSocket transport —
 * the Room-side integration is covered indirectly by the wider suite
 * exercising onJoin / onLeave (any regression there shows up in the
 * 347-test bundle run).
 */
import assert from 'assert';
import {
  LocalPresence,
  userRoomsKey,
  trackUserSession,
  releaseUserSession,
  type UserRoomEntry,
} from '@colyseus/core';

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

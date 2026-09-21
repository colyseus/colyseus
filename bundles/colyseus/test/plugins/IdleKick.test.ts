import assert from 'assert';
import sinon from 'sinon';
import { attachToTestRoom, ClientState, Protocol, Room } from '@colyseus/core';
import { IdleKickPlugin } from '../../src/plugins/idle-kick.ts';

/**
 * Unit tests for IdleKickPlugin. The plugin only touches three things on
 * the room: `clock.currentTime`, `clock.setInterval`, and `kickClient`
 * — plus `_lastMessageTime` on each client. We fake all of them with a
 * small stub so we can control time precisely. The last test drives a real
 * Room instead, to pin down where `_lastMessageTime` comes from.
 */

interface StubClient {
  sessionId: string;
  _lastMessageTime: number;
}

interface StubRoom {
  clock: {
    currentTime: number;
    setInterval: (fn: () => void, ms: number) => { clear: () => void };
  };
  clients: StubClient[];
  kicked: Array<{ sessionId: string; closeCode: number; reason?: string }>;
  kickClient: (sessionId: string, closeCode: number, reason?: string) => void;
  /** Drive the scheduled scan manually. */
  tick: () => void;
  /** Advance the clock and run the scan. */
  advance: (ms: number) => void;
}

function makeRoom(clients: StubClient[]): StubRoom {
  let scanFn: () => void = () => {};
  const kicked: StubRoom['kicked'] = [];
  const room: StubRoom = {
    clock: {
      currentTime: 0,
      setInterval(fn) {
        scanFn = fn;
        return { clear: () => { scanFn = () => {}; } };
      },
    },
    clients,
    kicked,
    kickClient(sessionId, closeCode, reason) {
      // mirror the real kickClient — synchronously remove from `clients`
      const idx = clients.findIndex((c) => c.sessionId === sessionId);
      if (idx !== -1) { clients.splice(idx, 1); }
      kicked.push({ sessionId, closeCode, reason });
    },
    tick() { scanFn(); },
    advance(ms) { this.clock.currentTime += ms; scanFn(); },
  };
  return room;
}

function makeClient(id: string, lastMessageTime: number = 0): StubClient {
  return { sessionId: id, _lastMessageTime: lastMessageTime };
}

describe('IdleKickPlugin', () => {

  it('measures activity from the last frame, not from the rate-limit counter', () => {
    // `_lastMessageTime` used to be the rate limiter's reset timestamp, which
    // only moves once per second — a client sending steadily got kicked anyway.
    const room = new Room();
    const plugin = new IdleKickPlugin({ timeoutMs: 1000 });
    const kick = sinon.stub(room, 'kickClient');
    const client: any = { sessionId: 'active', state: ClientState.JOINED, raw: sinon.spy() };
    room.clients.push(client);
    attachToTestRoom(plugin, room);

    room.clock.currentTime = 10_000;
    plugin['onJoin']!(client);
    assert.equal(client._messageCountResetsAt, undefined, 'the plugin leaves rate-limit state alone');

    room.clock.currentTime = 10_400;
    room['_onMessage'](client, Buffer.from([Protocol.PING]));
    room.clock.currentTime = 10_800;
    room['_onMessage'](client, Buffer.from([Protocol.PING]));
    assert.equal(client.raw.callCount, 2, 'the real dispatcher answered both pings');

    room.clock.currentTime = 11_100;
    plugin['scan']();
    sinon.assert.notCalled(kick);

    room.clock.currentTime = 11_800;
    plugin['scan']();
    sinon.assert.calledOnceWithExactly(kick, 'active', 1000, 'kicked');

    assert.equal(client._lastMessageTime, 10_800);
    assert.equal(client._messageCountResetsAt, 11_400, 'the rate-limit counter resets once per second');

    room.clock.clear();
  });

  it('kicks a client that has been idle past timeoutMs', () => {
    const plugin = new IdleKickPlugin({ timeoutMs: 1000 });
    const alice = makeClient('alice', 0);
    const room = makeRoom([alice]);
    attachToTestRoom(plugin, room as any);

    plugin["onJoin"]!(alice as any);              // seeds _lastMessageTime = 0
    plugin["onCreate"]!();

    room.advance(500);                        // not yet idle
    assert.deepEqual(room.kicked, []);

    room.advance(600);                        // now 1100ms past last activity
    assert.deepEqual(room.kicked, [{ sessionId: 'alice', closeCode: 1000, reason: 'kicked' }]);
  });

  it('does not kick a client whose _lastMessageTime is recent', () => {
    const plugin = new IdleKickPlugin({ timeoutMs: 1000 });
    const alice = makeClient('alice', 0);
    const room = makeRoom([alice]);
    attachToTestRoom(plugin, room as any);

    plugin["onJoin"]!(alice as any);
    plugin["onCreate"]!();

    room.advance(800);                        // tick at 800
    alice._lastMessageTime = room.clock.currentTime;
    room.advance(500);                        // 1300ms total but only 500 since last msg
    assert.deepEqual(room.kicked, []);
  });

  it('respects isExempt predicate', () => {
    const plugin = new IdleKickPlugin({
      timeoutMs: 1000,
      isExempt: (c) => c.sessionId === 'admin',
    });
    const admin = makeClient('admin', 0);
    const alice = makeClient('alice', 0);
    const room = makeRoom([admin, alice]);
    attachToTestRoom(plugin, room as any);

    plugin["onJoin"]!(admin as any);
    plugin["onJoin"]!(alice as any);
    plugin["onCreate"]!();

    room.advance(2000);
    assert.deepEqual(room.kicked.map((k) => k.sessionId), ['alice']);
  });

  it('fires onKick callback with the idle duration', () => {
    const calls: Array<[string, number]> = [];
    const plugin = new IdleKickPlugin({
      timeoutMs: 1000,
      onKick: (c, idle) => calls.push([c.sessionId, idle]),
    });
    const alice = makeClient('alice', 0);
    const room = makeRoom([alice]);
    attachToTestRoom(plugin, room as any);

    plugin["onJoin"]!(alice as any);
    plugin["onCreate"]!();

    room.advance(1500);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], 'alice');
    assert.equal(calls[0][1], 1500);
  });

  it('uses the configured closeCode and reason', () => {
    const plugin = new IdleKickPlugin({ timeoutMs: 1000, closeCode: 4040, reason: 'afk' });
    const alice = makeClient('alice', 0);
    const room = makeRoom([alice]);
    attachToTestRoom(plugin, room as any);

    plugin["onJoin"]!(alice as any);
    plugin["onCreate"]!();
    room.advance(1500);

    assert.deepEqual(room.kicked, [{ sessionId: 'alice', closeCode: 4040, reason: 'afk' }]);
  });

  it('clears the scan interval on dispose', () => {
    const plugin = new IdleKickPlugin({ timeoutMs: 1000 });
    const alice = makeClient('alice', 0);
    const room = makeRoom([alice]);
    attachToTestRoom(plugin, room as any);

    plugin["onJoin"]!(alice as any);
    plugin["onCreate"]!();
    plugin["onDispose"]!();

    room.advance(2000);                       // scan should be a no-op now
    assert.deepEqual(room.kicked, []);
  });

  it('seeds _lastMessageTime on join so silent newcomers are not instantly kicked', () => {
    const plugin = new IdleKickPlugin({ timeoutMs: 1000 });
    const room = makeRoom([]);
    attachToTestRoom(plugin, room as any);
    plugin["onCreate"]!();

    // simulate the room clock advancing before alice joins
    room.clock.currentTime = 10_000;
    const alice = makeClient('alice', 0);     // _lastMessageTime stays 0 until plugin.onJoin
    room.clients.push(alice);
    plugin["onJoin"]!(alice as any);

    assert.equal(alice._lastMessageTime, 10_000);

    room.advance(500);
    assert.deepEqual(room.kicked, []);
  });

});

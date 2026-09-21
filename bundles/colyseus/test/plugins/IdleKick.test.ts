import assert from 'assert';
import { attachToTestRoom, Room, ClientState, Protocol } from '@colyseus/core';
import sinon from 'sinon';
import { IdleKickPlugin } from '../../src/plugins/idle-kick.ts';

/**
 * Tests for IdleKickPlugin. Most cases use stub clients, clock and kickClient
 * to control time precisely. The regression also exercises the real Room
 * message dispatcher.
 */

interface StubClient {
  sessionId: string;
  _lastActivityTime: number;
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

function makeClient(id: string, lastActivityTime: number = 0): StubClient {
  return { sessionId: id, _lastActivityTime: lastActivityTime };
}

describe('IdleKickPlugin', () => {

  it('counts recent inbound frames independently of the rate-limit window', () => {
    const room = new Room();
    const plugin = new IdleKickPlugin({ timeoutMs: 1000 });
    const kick = sinon.stub(room, 'kickClient');
    const client: any = { sessionId: 'active', state: ClientState.JOINED, raw: sinon.spy() };
    room.clients.push(client);
    attachToTestRoom(plugin, room);
    room.clock.currentTime = 10_000;
    plugin["onJoin"]!(client);

    try {
      room.clock.currentTime = 10_400;
      room['_onMessage'](client, Buffer.from([Protocol.PING]));
      room.clock.currentTime = 10_800;
      room['_onMessage'](client, Buffer.from([Protocol.PING]));
      assert.equal(client.raw.callCount, 2, 'real room dispatch responds to the pings');
      assert.equal(client._lastMessageTime, 10_000, 'the rate-limit window is unchanged');
      assert.equal(client._numMessagesLastSecond, 2);

      room.clock.currentTime = 11_100;
      plugin['scan']();
      sinon.assert.notCalled(kick);

      room.clock.currentTime = 11_800;
      plugin['scan']();
      sinon.assert.calledOnceWithExactly(kick, 'active', 1000, 'kicked');
    } finally {
      kick.restore();
      room.clock.clear();
      room.clock.stop();
    }
  });

  it('kicks a client that has been idle past timeoutMs', () => {
    const plugin = new IdleKickPlugin({ timeoutMs: 1000 });
    const alice = makeClient('alice', 0);
    const room = makeRoom([alice]);
    attachToTestRoom(plugin, room as any);

    plugin["onJoin"]!(alice as any);              // seeds _lastActivityTime = 0
    plugin["onCreate"]!();

    room.advance(500);                        // not yet idle
    assert.deepEqual(room.kicked, []);

    room.advance(600);                        // now 1100ms past last activity
    assert.deepEqual(room.kicked, [{ sessionId: 'alice', closeCode: 1000, reason: 'kicked' }]);
  });

  it('does not kick a client whose _lastActivityTime is recent', () => {
    const plugin = new IdleKickPlugin({ timeoutMs: 1000 });
    const alice = makeClient('alice', 0);
    const room = makeRoom([alice]);
    attachToTestRoom(plugin, room as any);

    plugin["onJoin"]!(alice as any);
    plugin["onCreate"]!();

    room.advance(800);                        // tick at 800
    alice._lastActivityTime = room.clock.currentTime;
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

  it('seeds _lastActivityTime on join so silent newcomers are not instantly kicked', () => {
    const plugin = new IdleKickPlugin({ timeoutMs: 1000 });
    const room = makeRoom([]);
    attachToTestRoom(plugin, room as any);
    plugin["onCreate"]!();

    // simulate the room clock advancing before alice joins
    room.clock.currentTime = 10_000;
    const alice = makeClient('alice', 0);     // _lastActivityTime stays 0 until plugin.onJoin
    room.clients.push(alice);
    plugin["onJoin"]!(alice as any);

    assert.equal(alice._lastActivityTime, 10_000);

    room.advance(500);
    assert.deepEqual(room.kicked, []);
  });

});

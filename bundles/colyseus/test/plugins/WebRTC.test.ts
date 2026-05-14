import assert from 'assert';
import { attachToTestRoom } from '@colyseus/core';
import { WebRTCPlugin } from '../../src/plugins/webrtc.ts';

/**
 * Unit tests for the WebRTC signaling plugin. We bypass the full Room
 * machinery — `attachToTestRoom` injects a stub room exposing only the
 * pieces the plugin reaches for (`clients`, `broadcast`). Each test
 * starts with a fresh plugin instance so the internal `peers` set
 * doesn't bleed between cases.
 */

interface StubClient {
  sessionId: string;
  sent: Array<[string, any]>;
  send: (type: string, payload: any) => void;
}

interface StubRoom {
  clients: StubClient[] & { getById(id: string): StubClient | undefined };
  broadcasts: Array<[string, any, any]>;
  broadcast: (type: string, payload: any, options?: any) => void;
}

function makeClient(id: string): StubClient {
  const sent: StubClient['sent'] = [];
  return {
    sessionId: id,
    sent,
    send(type, payload) { sent.push([type, payload]); },
  };
}

function makeRoom(clients: StubClient[]): StubRoom {
  const broadcasts: StubRoom['broadcasts'] = [];
  const arr = clients as any;
  arr.getById = (id: string) => clients.find((c) => c.sessionId === id);
  return {
    clients: arr,
    broadcasts,
    broadcast(type, payload, options) { broadcasts.push([type, payload, options]); },
  };
}

describe('WebRTCPlugin', () => {

  it('webrtc:join sends an empty peer list to the first joiner and broadcasts peer-joined', () => {
    const plugin = new WebRTCPlugin();
    const alice = makeClient('alice');
    const room = makeRoom([alice]);
    attachToTestRoom(plugin, room as any);

    plugin["messages"]!['webrtc:join'](alice as any);

    assert.deepEqual(alice.sent, [['webrtc:peers', []]]);
    assert.deepEqual(room.broadcasts, [['webrtc:peer-joined', 'alice', { except: alice }]]);
  });

  it('webrtc:join reports already-joined peers to subsequent joiners', () => {
    const plugin = new WebRTCPlugin();
    const alice = makeClient('alice');
    const bob = makeClient('bob');
    const room = makeRoom([alice, bob]);
    attachToTestRoom(plugin, room as any);

    plugin["messages"]!['webrtc:join'](alice as any);
    plugin["messages"]!['webrtc:join'](bob as any);

    // Bob's peers list should contain alice (already in the mesh)
    assert.deepEqual(bob.sent[0], ['webrtc:peers', ['alice']]);
  });

  it('webrtc:join is idempotent — re-joining does not re-broadcast peer-joined', () => {
    const plugin = new WebRTCPlugin();
    const alice = makeClient('alice');
    const room = makeRoom([alice]);
    attachToTestRoom(plugin, room as any);

    plugin["messages"]!['webrtc:join'](alice as any);
    plugin["messages"]!['webrtc:join'](alice as any);

    // Only one broadcast in total — the second join just re-reads the peer list.
    assert.equal(room.broadcasts.length, 1);
  });

  it('webrtc:offer relays the SDP to the target client only', () => {
    const plugin = new WebRTCPlugin();
    const alice = makeClient('alice');
    const bob = makeClient('bob');
    const carol = makeClient('carol');
    const room = makeRoom([alice, bob, carol]);
    attachToTestRoom(plugin, room as any);

    const sdp = { type: 'offer', sdp: 'v=0...' };
    plugin["messages"]!['webrtc:offer'](alice as any, { targetId: 'bob', sdp });

    assert.deepEqual(bob.sent, [['webrtc:offer', { peerId: 'alice', sdp }]]);
    assert.deepEqual(carol.sent, [], 'unrelated peer should not receive the offer');
  });

  it('webrtc:answer and webrtc:ice-candidate relay similarly', () => {
    const plugin = new WebRTCPlugin();
    const alice = makeClient('alice');
    const bob = makeClient('bob');
    const room = makeRoom([alice, bob]);
    attachToTestRoom(plugin, room as any);

    const sdp = { type: 'answer', sdp: 'v=0...' };
    plugin["messages"]!['webrtc:answer'](bob as any, { targetId: 'alice', sdp });
    assert.deepEqual(alice.sent[0], ['webrtc:answer', { peerId: 'bob', sdp }]);

    const candidate = { candidate: 'candidate:...', sdpMLineIndex: 0, sdpMid: '0' };
    plugin["messages"]!['webrtc:ice-candidate'](alice as any, { targetId: 'bob', candidate });
    assert.deepEqual(bob.sent[0], ['webrtc:ice-candidate', { peerId: 'alice', candidate }]);
  });

  it('relays are no-ops when the target client has gone', () => {
    const plugin = new WebRTCPlugin();
    const alice = makeClient('alice');
    const room = makeRoom([alice]); // bob is missing
    attachToTestRoom(plugin, room as any);

    plugin["messages"]!['webrtc:offer'](alice as any, {
      targetId: 'bob',
      sdp: { type: 'offer', sdp: '' },
    });

    // No throw, no broadcast — silent drop.
    assert.equal(alice.sent.length, 0);
    assert.equal(room.broadcasts.length, 0);
  });

  it('onLeave broadcasts peer-left only for clients that joined the mesh', () => {
    const plugin = new WebRTCPlugin();
    const alice = makeClient('alice');
    const bob = makeClient('bob');
    const room = makeRoom([alice, bob]);
    attachToTestRoom(plugin, room as any);

    plugin["messages"]!['webrtc:join'](alice as any);
    room.broadcasts.length = 0; // drop the peer-joined we just emitted

    plugin["onLeave"]!(alice as any); // joined → peer-left fires
    plugin["onLeave"]!(bob as any);   // never joined → silent

    assert.deepEqual(room.broadcasts, [['webrtc:peer-left', 'alice', { except: alice }]]);
  });

});

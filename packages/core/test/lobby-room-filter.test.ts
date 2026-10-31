// @vitest-environment node
/**
 * LobbyRoom lobby filtering. `filterItemForClient()` reads `room.metadata` for
 * every field a client's filter names, but `IRoomCache.metadata` is optional:
 * `initializeRoomCache()` leaves it `undefined` for any room whose handler
 * declares neither `filterBy()` nor `sortBy()`, and `LobbyRoom.onCreate()`
 * puts *every* public room into `this.rooms`. A metadata filter used to throw
 * out of `onJoin()` as soon as one of those rooms was in the lobby.
 *
 * Matrix: {room with metadata, room without} × {metadata filter, name filter}.
 */
import { describe, it, expect } from 'vitest';
import { LobbyRoom } from '../src/rooms/LobbyRoom.ts';
import type { IRoomCache } from '../src/matchmaker/driver.ts';

function makeListing(overrides: Partial<IRoomCache> = {}): IRoomCache {
  return {
    roomId: 'room-id',
    name: 'battle',
    processId: 'process-id',
    clients: 0,
    maxClients: 4,
    private: false,
    unlisted: false,
    metadata: undefined,
    ...overrides,
  } as IRoomCache;
}

function join(rooms: IRoomCache[], options: any) {
  const room = new LobbyRoom();
  (room as any).rooms = rooms;

  const sent: any[] = [];
  const client = { sessionId: 'session-id', send: (_type: string, payload: any) => sent.push(payload) };
  room.onJoin(client as any, options);

  // onJoin() sends the filtered room list as its only message
  return sent[0] as IRoomCache[];
}

describe('LobbyRoom — filtering the room list', () => {
  it('matches a metadata filter against a room that has metadata', () => {
    const listing = makeListing({ metadata: { mode: 'duel' } });
    expect(join([listing], { filter: { name: 'battle', metadata: { mode: 'duel' } } })).toEqual([listing]);
  });

  it('rejects a metadata filter whose value does not match', () => {
    const listing = makeListing({ metadata: { mode: 'duel' } });
    expect(join([listing], { filter: { name: 'battle', metadata: { mode: 'coop' } } })).toEqual([]);
  });

  it('does not match a room without metadata, instead of throwing', () => {
    const listing = makeListing(); // metadata: undefined, as initializeRoomCache() leaves it
    expect(join([listing], { filter: { name: 'battle', metadata: { mode: 'duel' } } })).toEqual([]);
  });

  it('filters a mixed lobby by metadata without throwing', () => {
    const withMetadata = makeListing({ roomId: 'a', metadata: { mode: 'duel' } });
    const withoutMetadata = makeListing({ roomId: 'b' });
    expect(join([withMetadata, withoutMetadata], { filter: { name: 'battle', metadata: { mode: 'duel' } } }))
      .toEqual([withMetadata]);
  });

  it('keeps name-only filtering unaffected', () => {
    const listing = makeListing();
    expect(join([listing], { filter: { name: 'battle' } })).toEqual([listing]);
    expect(join([listing], { filter: { name: 'other' } })).toEqual([]);
  });

  it('sends every room when the client provides no filter', () => {
    const listing = makeListing();
    expect(join([listing], {})).toEqual([listing]);
  });
});

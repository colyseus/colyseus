import * as assert from 'assert';

import { MatchMaker } from "../src/MatchMaker";

import { createDummyClient, DummyRoom, RoomVerifyClient, Client, RoomVerifyClientWithLock, RoomWithAsync, awaitForTimeout } from "./utils/mock";
import { RedisPresence } from "../src/presence/RedisPresence";
import { RemoteClient } from '../src/presence/RemoteClient';
import { isValidId } from '../src';

describe('RemoteClient & RedisPresence', function() {
  let matchMaker1: MatchMaker;
  let matchMaker2: MatchMaker;
  let matchMaker3: MatchMaker;

  async function registerHandlers (matchMaker: MatchMaker) {
    await matchMaker.registerHandler('room', DummyRoom);
    await matchMaker.registerHandler('room_two', DummyRoom);
    await matchMaker.registerHandler('room_three', DummyRoom);
    await matchMaker.registerHandler('dummy_room', DummyRoom);
    await matchMaker.registerHandler('room_async', RoomWithAsync);
  }

  async function connectClientToRoom(matchMaker: MatchMaker, client: any, roomName: string, options: any = {}) {
    const roomId = await matchMaker.onJoinRoomRequest(client, roomName, options);
    await matchMaker.connectToRoom(client, roomId);
    return roomId;
  }

  before(() => {
    // const redis = new RedisPresence();
    // redis.sub.flushdb();
  });

  after(async function () {
    this.timeout(1000);

    await matchMaker1.gracefullyShutdown();
    await matchMaker2.gracefullyShutdown();
    await matchMaker3.gracefullyShutdown();
  });

  beforeEach(async function () {
    matchMaker1 = new MatchMaker(new RedisPresence());
    matchMaker2 = new MatchMaker(new RedisPresence());
    matchMaker3 = new MatchMaker(new RedisPresence());

    await registerHandlers(matchMaker1);
    await registerHandlers(matchMaker2);
    await registerHandlers(matchMaker3);
  });

  // afterEach(() => clock.restore());

  describe("Inter-process communication", () => {

    it('should register RemoteClient on room owner\'s MatchMaker', async () => {
      const client1 = createDummyClient();
      const roomId = await connectClientToRoom(matchMaker1, client1, 'room');
      const room = matchMaker1.getRoomById(roomId);

      const client2 = createDummyClient();
      await connectClientToRoom(matchMaker2, client2, 'room');

      assert.ok(client1.sessionId);
      assert.ok(client2.sessionId);

      assert.equal(room.clients.length, 2);

      await room.disconnect(); // cleanup data on RedisPresence
    });

    it('should emit "close" event when RemoteClient disconnects', async () => {
      const client1 = createDummyClient();
      const roomId = await connectClientToRoom(matchMaker1, client1, 'room_two');
      const room = matchMaker1.getRoomById(roomId);

      const client2 = createDummyClient();
      const client3 = createDummyClient();

      const concurrentConnections = [
        connectClientToRoom(matchMaker2, client2, 'room_two'),
        connectClientToRoom(matchMaker2, client3, 'room_two')
      ];

      await Promise.all(concurrentConnections);

      const remoteClients = room.clients.filter(client => client instanceof RemoteClient);
      assert.equal(2, remoteClients.length);

      assert.ok(isValidId(client1.sessionId));
      assert.ok(isValidId(client2.sessionId));
      assert.ok(isValidId(client3.sessionId));

      client2.emit('close');
      client3.emit('close');

      await awaitForTimeout();
      assert.equal(room.clients.length, 1);

      client1.close();
      await awaitForTimeout(10);

      assert.ok(matchMaker1.getRoomById(roomId) === undefined);
    });

    it('should be able to receive messages', async () => {
      const client1 = createDummyClient();
      const roomId = await connectClientToRoom(matchMaker1, client1, 'room_three');
      const room = matchMaker1.getRoomById(roomId);

      const client2 = createDummyClient();
      const client3 = createDummyClient();
      const client4 = createDummyClient();

      const concurrentConnections = [
        connectClientToRoom(matchMaker2, client2, 'room_three'),
        connectClientToRoom(matchMaker2, client3, 'room_three'),
        connectClientToRoom(matchMaker3, client4, 'room_three')
      ];

      await Promise.all(concurrentConnections);

      client1.receive(["SOMETHING"])
      client2.receive(["SOMETHING"]);
      client3.receive(["SOMETHING"]);
      client4.receive(["SOMETHING"]);

      await awaitForTimeout(10);

      assert.equal(client1.lastMessage[1], "SOMETHING");
      assert.equal(client2.lastMessage[1], "SOMETHING");
      assert.equal(client3.lastMessage[1], "SOMETHING");
      assert.equal(client4.lastMessage[1], "SOMETHING");

      await room.disconnect(); // cleanup data on RedisPresence
    });
  });

});


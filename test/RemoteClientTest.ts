import * as assert from 'assert';

import { MatchMaker } from "../src/MatchMaker";

import { createDummyClient, DummyRoom, RoomVerifyClient, Client, RoomVerifyClientWithLock, RoomWithAsync, awaitForTimeout } from "./utils/mock";
import { RedisPresence } from "../src/presence/RedisPresence";

describe('RemoteClient', function() {
  let matchMaker1: MatchMaker;
  let matchMaker2: MatchMaker;
  // let clock: sinon.SinonFakeTimers;

  async function registerHandlers (matchMaker: MatchMaker) {
    await matchMaker.registerHandler('room', DummyRoom);
    await matchMaker.registerHandler('room_two', DummyRoom);
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
  });

  beforeEach(async function () {
    matchMaker1 = new MatchMaker(new RedisPresence());
    matchMaker2 = new MatchMaker(new RedisPresence());

    await registerHandlers(matchMaker1);
    await registerHandlers(matchMaker2);
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
    });

    it('should emit "close" event when RemoteClient disconnects', async () => {
      const client1 = createDummyClient();
      const roomId = await connectClientToRoom(matchMaker1, client1, 'room_two');
      const room = matchMaker1.getRoomById(roomId);

      const client2 = createDummyClient();
      await connectClientToRoom(matchMaker2, client2, 'room_two');

      const client3 = createDummyClient();
      await connectClientToRoom(matchMaker2, client3, 'room_two');

      client2.emit('close');
      client3.emit('close');

      await awaitForTimeout();
      assert.equal(room.clients.length, 1);
    });
  });

});


import * as assert from "assert";
import * as msgpack from "notepack.io";

import { Server } from "../src/Server";
import { Protocol } from "../src/Protocol";
import { createEmptyClient, DummyRoom, RoomWithAsync, Client, awaitForTimeout } from "./utils/mock";
import { isValidId, Room } from "../src";

describe('Server', () => {
  const server = new Server({ port: 1111 });
  const matchMaker = server.matchMaker;

  let clients: Client[];

  // register dummy room
  server.register('room', DummyRoom);
  server.register('invalid_room', DummyRoom);
  server.register('room_async', RoomWithAsync);

  // connect 5 clients into server
  beforeEach(() => {
    clients = [];
    for (var i = 0; i < 5; i++) {
      var client = createEmptyClient();
      clients.push(client);
      (<any>server).onConnection(client, {});
    }
  });

  afterEach(() => {
    // disconnect dummy clients
    for (var i = 0, len = clients.length; i < len; i++) {
      clients[i].close();
    }
  });

  describe('join request', () => {
    it('should register client listeners when joined a room', async () => {
      const client0 = clients[0];
      const client1 = clients[1];

      client0.emit('message', msgpack.encode([Protocol.JOIN_ROOM, "room", { requestId: 0 }]));
      client1.emit('message', msgpack.encode([Protocol.JOIN_ROOM, "room", { requestId: 0 }]));
      await awaitForTimeout(100);

      const lastMessage = client0.lastMessage;
      assert.equal(lastMessage[0], Protocol.JOIN_ROOM);
      assert.ok(isValidId(lastMessage[1]));
      assert.equal(lastMessage[2], 0);
    });

    it('should join a room with valid options', async () => {
      const client = clients[2];

      client.emit('message', msgpack.encode([Protocol.JOIN_ROOM, "room", { requestId: 1 }]));
      await awaitForTimeout(100);

      assert.equal(client.lastMessage[0], Protocol.JOIN_ROOM);
      assert.ok(isValidId(client.lastMessage[1]));
      assert.equal(client.lastMessage[2], 1);
    });

    it('shouldn\'t join a room with invalid options', async () => {
      const client = clients[3];

      client.emit('message', msgpack.encode([Protocol.JOIN_ROOM, "invalid_room", { invalid_param: 10 }]));
      await awaitForTimeout(100);

      assert.equal(client.lastMessage[0], Protocol.JOIN_ERROR);
      assert.equal(client.lastMessage[1], 'invalid_room');
    });

  });

  describe('matchmaking', () => {
    it('joining a room that is dispoing disposing room', async function () {
      this.timeout(10000);

      const joinOptions = {};

      // connect first client
      const client1 = clients[0];
      client1.emit('message', msgpack.encode([Protocol.JOIN_ROOM, "room_async", joinOptions]));
      await awaitForTimeout(20);

      const lastMessage = client1.lastMessage;
      const roomId = lastMessage[1];

      const roomClient1 = createEmptyClient();
      roomClient1.upgradeReq = { url: `ws://localhost:1111/${roomId}?colyseusid=${client1.id}` };

      (<any>server).verifyClient({ req: roomClient1.upgradeReq }, async (success) => {
        (<any>server).onConnection(roomClient1);
        await awaitForTimeout(20);
        roomClient1.close();
      });

      // connect second client
      const client2 = clients[1];
      await awaitForTimeout(220);
      client2.emit('message', msgpack.encode([Protocol.JOIN_ROOM, "room_async", joinOptions]));

      await awaitForTimeout(50);

      const roomId2 = client2.lastMessage[1];

      const roomClient2 = createEmptyClient();
      roomClient2.upgradeReq = { url: `ws://localhost:1111/${roomId2}?colyseusid=${client2.id}` };

      (<any>server).verifyClient({ req: roomClient2.upgradeReq }, async (success) => {
        (<any>server).onConnection(roomClient2);
        await awaitForTimeout(20);
      });

      await awaitForTimeout(500);

      assert.ok(true);
    });
  });

});

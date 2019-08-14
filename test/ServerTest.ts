import assert from "assert";
import msgpack from "notepack.io";

import { Server } from "../src/Server";
import { Protocol } from "../src/Protocol";
import { createEmptyClient, DummyRoom, RoomWithAsync, Client, awaitForTimeout, utf8Read } from "./utils/mock";
import { isValidId, Room } from "../src";

describe('Server', () => {
  const server = new Server({ port: 1111 });
  const matchMaker = server.matchMaker;

  let clients: Client[];

  // register dummy room
  server.define('room', DummyRoom);
  server.define('invalid_room', DummyRoom);
  server.define('room_async', RoomWithAsync);

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

      client0.emit('message', msgpack.encode([Protocol.JOIN_REQUEST, "room", { requestId: 5 }]));
      client1.emit('message', msgpack.encode([Protocol.JOIN_REQUEST, "room", { requestId: 5 }]));
      await awaitForTimeout(100);

      assert.equal((client0.messages[1] as Buffer).readUInt8(0), Protocol.JOIN_REQUEST);
      assert.equal((client0.messages[1] as Buffer).readUInt8(1), 5); // requestId
      assert.ok(isValidId(utf8Read(client0.messages[1], 2)));
    });

    it('should join a room with valid options', async () => {
      const client = clients[2];

      client.emit('message', msgpack.encode([Protocol.JOIN_REQUEST, "room", { requestId: 1 }]));
      await awaitForTimeout(100);

      assert.equal((client.messages[1] as Buffer).readUInt8(0), Protocol.JOIN_REQUEST);
      assert.equal((client.messages[1] as Buffer).readUInt8(1), 1); // requestId
      assert.ok(isValidId(utf8Read(client.messages[1], 2)));
    });

    it('shouldn\'t join a non-existant room', async () => {
      const client = clients[3];

      client.emit('message', msgpack.encode([Protocol.JOIN_REQUEST, "non_existant_room", {}]));
      await awaitForTimeout(100);

      assert.equal((client.messages[1] as Buffer).readUInt8(0), Protocol.JOIN_ERROR);
      assert.equal(utf8Read(client.messages[1], 1), `no available handler for "non_existant_room"`);
    });

    it('shouldn\'t join a room with invalid options', async () => {
      const client = clients[3];

      client.emit('message', msgpack.encode([Protocol.JOIN_REQUEST, "invalid_room", { invalid_param: 10 }]));
      await awaitForTimeout(100);

      assert.equal((client.messages[1] as Buffer).readUInt8(0), Protocol.JOIN_ERROR);
      assert.ok(/^failed to auto-create room "invalid_room"/gi.test(utf8Read(client.messages[1], 1)));
    });

  });

  describe('matchmaking', () => {
    it('joining a room that is dispoing', async function () {
      this.timeout(10000);

      // connect first client
      const client1 = clients[0];
      client1.emit('message', msgpack.encode([Protocol.JOIN_REQUEST, "room_async", {}]));
      await awaitForTimeout(20);

      const roomId = utf8Read(client1.messages[1], 1);
      const roomClient1 = createEmptyClient();
      roomClient1.upgradeReq = { url: `ws://localhost:1111/${roomId}?colyseusid=${client1.id}` };

      let client1Success: boolean;
      await (<any>server).verifyClient({ req: roomClient1.upgradeReq }, async (success) => {
        client1Success = success;
        (<any>server).onConnection(roomClient1);
        await awaitForTimeout(20);
        roomClient1.close();
      });
      assert.ok(client1Success);

      // connect second client
      const client2 = clients[1];
      await awaitForTimeout(RoomWithAsync.ASYNC_TIMEOUT + 20);
      client2.emit('message', msgpack.encode([Protocol.JOIN_REQUEST, "room_async", {}]));

      await awaitForTimeout(50);

      const roomId2 = utf8Read(client2.messages[1], 1);

      const roomClient2 = createEmptyClient();
      roomClient2.upgradeReq = { url: `ws://localhost:1111/${roomId2}?colyseusid=${client2.id}` };

      let client2Success: boolean;
      await (<any>server).verifyClient({ req: roomClient2.upgradeReq }, async (success) => {
        client2Success = success;
        (<any>server).onConnection(roomClient2);
        await awaitForTimeout(20);
      });
      assert.ok(client2Success);

      await awaitForTimeout(500);

      assert.ok(true);
    });
  });

});

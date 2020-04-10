import assert from "assert";
import sinon from "sinon";
import * as Colyseus from "colyseus.js";

import { matchMaker, Room, Client, Server, ErrorCode } from "../../src";
import { DummyRoom, DRIVERS, timeout, Room3Clients, PRESENCE_IMPLEMENTATIONS, Room2Clients, Room2ClientsExplicitLock } from "./../utils";

import { LobbyRoom } from "../../src";


describe("LobbyRoom: Integration", () => {
  for (let i = 0; i < PRESENCE_IMPLEMENTATIONS.length; i++) {
    const presence = PRESENCE_IMPLEMENTATIONS[i];

    for (let j = 0; j < DRIVERS.length; j++) {
      const driver = DRIVERS[j];

      describe(`Driver => ${(driver.constructor as any).name}, Presence => ${presence.constructor.name}`, () => {
        const TEST_PORT = 4000 + Math.floor((Math.random() * 1000));
        const TEST_ENDPOINT = `ws://localhost:${TEST_PORT}`;

        const server = new Server({
          pingInterval: 150,
          pingMaxRetries: 1,
          presence,
          driver
        });

        const client = new Colyseus.Client(TEST_ENDPOINT);

        before(async () => {
          // listen for testing
          await server.listen(TEST_PORT);
        });

        beforeEach(async () => {
          // setup matchmaker
          matchMaker.setup(presence, driver, 'dummyProcessId')

          // define a room
          matchMaker.defineRoomType("lobby", LobbyRoom);
          matchMaker.defineRoomType("dummy_1", DummyRoom).enableRealtimeListing();
          matchMaker.defineRoomType("dummy_2", DummyRoom).enableRealtimeListing();
        });

        after(async () => await server.gracefullyShutdown(false));
        afterEach(async () => await matchMaker.gracefullyShutdown())

        it("should receive full list of rooms when connecting.", async () => {
          await client.create('dummy_1');
          await client.create('dummy_2');

          const lobby = await client.joinOrCreate("lobby");

          let onMessageCalled = false;
          lobby.onMessage("rooms", (rooms) => {
            onMessageCalled = true;
            assert.equal(2, rooms.length);
          });
          lobby.onMessage("+", () => {});
          lobby.onMessage("-", () => {});

          await timeout(50);

          assert.ok(onMessageCalled);
        });

        it("should receive + when rooms are created", async () => {
          const lobby = await client.joinOrCreate("lobby");

          let onMessageCalled = false;
          let onAddCalled = 0;

          lobby.onMessage("rooms", (rooms) => {
            onMessageCalled = true;
            assert.equal(0, rooms.length);
          });

          lobby.onMessage("+", ([roomId, data]) => {
            onAddCalled++;
            assert.equal("string", typeof (roomId));
            assert.equal("dummy_1", data.name)
          });

          lobby.onMessage("-", () => {});

          await client.create('dummy_1');
          await client.create('dummy_1');

          await timeout(50);

          assert.ok(onMessageCalled);

          // FIXME: currently, it is called 4 times because each onCreate + onJoin are forcing updates
          // therefore triggering onMessage.
          assert.equal(4, onAddCalled);
        });

        it("should receive - when rooms are removed", async () => {
          const lobby = await client.joinOrCreate("lobby");

          let onMessageCalled = false;
          let onRemoveCalled = 0;

          lobby.onMessage("rooms", (rooms) => {
            onMessageCalled = true;
            assert.equal(0, rooms.length);
          });
          lobby.onMessage("+", () => {});

          await client.create('dummy_1');
          const dummy_1 = await client.create('dummy_1');
          const dummyRoomId = dummy_1.id;

          lobby.onMessage("-", (roomId) => {
            onRemoveCalled++;
            assert.equal(roomId, dummyRoomId);
          });

          dummy_1.leave();
          await timeout(50);

          assert.ok(onMessageCalled);
          assert.equal(1, onRemoveCalled);
        });

      });

    }
  }
});
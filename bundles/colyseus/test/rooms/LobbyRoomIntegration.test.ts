import assert from "assert";
import * as Colyseus from "colyseus.js";
import { matchMaker, Server, LobbyRoom } from "../../src";
import { DummyRoom, DRIVERS, timeout, PRESENCE_IMPLEMENTATIONS } from "./../utils";

describe("LobbyRoom: Integration", () => {
  for (let i = 0; i < PRESENCE_IMPLEMENTATIONS.length; i++) {
    const presence = new PRESENCE_IMPLEMENTATIONS[i]();

    for (let j = 0; j < DRIVERS.length; j++) {
      const driver = new DRIVERS[j]();

      describe(`Driver => ${(driver.constructor as any).name}, Presence => ${presence.constructor.name}`, () => {
        const TEST_PORT = 4000 + Math.floor((Math.random() * 1000));
        const TEST_ENDPOINT = `ws://localhost:${TEST_PORT}`;

        const server = new Server({
          greet: false,
          presence,
          driver
        });

        const client = new Colyseus.Client(TEST_ENDPOINT);

        before(async () => {
          // listen for testing
          await matchMaker.setup(presence, driver);
          await server.listen(TEST_PORT);
        });

        beforeEach(async () => {
          // setup matchmaker
          await matchMaker.setup(presence, driver);
          await matchMaker.accept();

          // define a room
          matchMaker.defineRoomType("lobby", LobbyRoom);
          matchMaker.defineRoomType("dummy_1", DummyRoom).enableRealtimeListing();
          matchMaker.defineRoomType("dummy_2", DummyRoom).enableRealtimeListing();
        });

        after(async () => await server.gracefullyShutdown(false));
        afterEach(async () => await matchMaker.gracefullyShutdown());

        it("should receive full list of rooms when connecting.", async () => {
          await client.create('dummy_1');
          await client.create('dummy_2');

          const lobby = await client.joinOrCreate("lobby");

          let onMessageCalled = false;
          lobby.onMessage("rooms", (rooms) => {
            onMessageCalled = true;
            assert.equal(2, rooms.length);
          });
          lobby.onMessage("+", () => { });
          lobby.onMessage("-", () => { });

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
            assert.equal("dummy_1", data.name);
          });

          lobby.onMessage("-", () => { });

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
          lobby.onMessage("+", () => { });

          await client.create('dummy_1');
          const dummy_1 = await client.create('dummy_1');
          const dummyRoomId = dummy_1.roomId;

          lobby.onMessage("-", (roomId) => {
            onRemoveCalled++;
            assert.equal(roomId, dummyRoomId);
          });

          await dummy_1.leave();
          await timeout(50);

          assert.ok(onMessageCalled);
          assert.equal(1, onRemoveCalled);
        });

        it("should update rooms field when room marked as private", async () => {
          const serverLobby = await matchMaker.createRoom('lobby', {});
          const serverLobbyRoom = await matchMaker.getLocalRoomById(serverLobby.roomId) as LobbyRoom;
          const lobby = await client.join("lobby");

          let allRooms: Colyseus.RoomAvailable[] = [];

          lobby.onMessage("rooms", (rooms) => {
            allRooms = rooms;
          });

          lobby.onMessage("+", ([roomId, room]) => {
            const roomIndex = allRooms.findIndex((room) => room.roomId === roomId);
            if (roomIndex !== -1) {
              allRooms[roomIndex] = room;

            } else {
              allRooms.push(room);
            }
          });

          lobby.onMessage("-", (roomId) => {
            allRooms = allRooms.filter((room) => room.roomId !== roomId);
          });

          await client.create('dummy_1');
          const dummy_1 = await client.create('dummy_1');
          const dummyRoomId = dummy_1.roomId;

          assert.equal(serverLobbyRoom.rooms.length, 2);
          assert.equal(allRooms.length, 2);
          assert.equal((await client.getAvailableRooms('dummy_1')).length, 2);

          await matchMaker.remoteRoomCall(dummyRoomId, 'setPrivate');

          await timeout(50);

          assert.equal(serverLobbyRoom.rooms.length, 1);
          assert.equal(allRooms.length, 1);
          assert.equal((await client.getAvailableRooms('dummy_1')).length, 1);

          await matchMaker.remoteRoomCall(dummyRoomId, 'setPrivate', [false]);

          await timeout(50);

          assert.equal(serverLobbyRoom.rooms.length, 2);
          assert.equal(allRooms.length, 2);
          assert.equal((await client.getAvailableRooms('dummy_1')).length, 2);

          await lobby.leave();
        });
      });

    }
  }
});

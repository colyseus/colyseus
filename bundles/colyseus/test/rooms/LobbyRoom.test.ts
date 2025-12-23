import assert from "assert";
import { matchMaker, LobbyRoom, type Presence, type MatchMakerDriver, Server, Room, updateLobby, Deferred } from "../../src/index.ts";
import { PRESENCE_IMPLEMENTATIONS, DRIVERS, DummyRoom, timeout } from "../utils/index.ts";
import { Client as SDKClient, Room as SDKRoom } from "@colyseus/sdk";

const TEST_PORT = 8567;

async function createLobbyRoom () {
  const room = await matchMaker.createRoom("lobby", {});
  return matchMaker.getLocalRoomById(room.roomId) as LobbyRoom;
}

function createSDKClient() {
  return new SDKClient(`ws://localhost:${TEST_PORT}`);
}

describe("LobbyRoom", () => {
  for (let i = 0; i < PRESENCE_IMPLEMENTATIONS.length; i++) {

    for (let j = 0; j < DRIVERS.length; j++) {
      let presence: Presence;
      let driver: MatchMakerDriver;
      let server: Server;

      describe(`Driver => ${DRIVERS[j].name}, Presence => ${PRESENCE_IMPLEMENTATIONS[i].name}`, () => {
        /**
         * `setup` matchmaker to re-set graceful shutdown status
         */
        beforeEach(async () => {
          driver = new DRIVERS[j]();
          presence = new PRESENCE_IMPLEMENTATIONS[i]();

          server = new Server({
            greet: false,
            gracefullyShutdown: false,
            presence,
            driver,
            // transport: new uWebSocketsTransport(),
          });

          // setup matchmaker
          matchMaker.setup(presence, driver);
          matchMaker.defineRoomType("lobby", LobbyRoom);
          matchMaker.defineRoomType("dummy_1", DummyRoom).enableRealtimeListing();
          matchMaker.defineRoomType("dummy_2", DummyRoom).enableRealtimeListing();

          await driver.clear();

          // listen for testing
          await server.listen(TEST_PORT);
        });

        /**
         * ensure no rooms are avaialble in-between tests
         */
        afterEach(async () => await server.gracefullyShutdown(false));

        it("initial room list should be empty", async () => {
          const lobby = await createLobbyRoom();
          assert.strictEqual(0, lobby.rooms.length);
        });

        it("inital room list should contain existing rooms", async () => {
          await matchMaker.create("dummy_1", {});
          await matchMaker.create("dummy_2", {});
          const lobby = await createLobbyRoom();
          assert.strictEqual(2, lobby.rooms.length);
        });

        it("should receive update when room is created", async () => {
          const lobby = await createLobbyRoom();
          assert.strictEqual(0, lobby.rooms.length);

          await matchMaker.createRoom("dummy_1", {});

          // wait a bit until LobbyRoom received the update
          await timeout(50);
          assert.strictEqual(1, lobby.rooms.length);
        });

        it("should properly remove disposed room from lobby", async () => {
          const lobby = await createLobbyRoom();
          assert.strictEqual(0, lobby.rooms.length);

          // Create a room with realtime listing enabled
          const roomData = await matchMaker.createRoom("dummy_1", {});

          // Wait for the room to appear in lobby
          await timeout(50);
          assert.strictEqual(1, lobby.rooms.length);
          assert.strictEqual(roomData.roomId, lobby.rooms[0].roomId);

          // Dispose the room
          await matchMaker.remoteRoomCall(roomData.roomId, "disconnect");

          // Wait for the lobby to process the removal
          await timeout(50);
          assert.strictEqual(0, lobby.rooms.length, "Room should be removed from lobby list after disposal");
        });

        it("updating metadata should not cause race condition", async () => {
          const onDisposeDeferred = new Deferred();

          matchMaker.defineRoomType("metadata_room", class _ extends Room {
            onCreate(options: any) {
              this.setMetadata({ field: "value 1" });
            }
            onJoin() {
              this.setMetadata({ field: "value 2" });
            }
            onLeave() {
              this.setMetadata({ field: "value " + Math.random() });
              this.setMetadata({ field: "value " + Math.random() });
            }
            onDispose() {
              onDisposeDeferred.resolve();
            }
          }).enableRealtimeListing();

          const lobby = await createLobbyRoom();
          assert.strictEqual(0, lobby.rooms.length);

          const roomData = await matchMaker.createRoom("metadata_room", {});

          const client = createSDKClient();
          const [clientRoom1, clientRoom2] = await Promise.all([
            client.joinById(roomData.roomId, {}),
            client.joinById(roomData.roomId, {}),
          ]);

          assert.strictEqual(1, lobby.rooms.length, "Room should be added to lobby list after metadata update");
          assert.strictEqual(lobby.rooms[0].metadata.field, "value 2", "Metadata should be set");

          clientRoom1.leave();
          clientRoom2.leave();

          await onDisposeDeferred;

          assert.strictEqual(0, lobby.rooms.length, "Room should be removed from lobby list after disposal");
        });
      });

    }
  }

});

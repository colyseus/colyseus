import assert from "assert";
import { matchMaker, LobbyRoom, type Presence, type MatchMakerDriver, Server, Room, updateLobby, Deferred } from "../../src/index.ts";
import { PRESENCE_IMPLEMENTATIONS, DRIVERS, DummyRoom, timeout, waitUntil } from "../utils/index.ts";
import { Client as SDKClient, Room as SDKRoom } from "@colyseus/sdk";

const TEST_PORT = 8567;

async function createLobbyRoom () {
  const room = await matchMaker.createRoom("lobby", {});
  return matchMaker.getLocalRoomById(room.roomId) as LobbyRoom;
}

function createSDKClient() {
  return new SDKClient(`ws://localhost:${TEST_PORT}`);
}

function nextRooms(lobby: SDKRoom) {
  return new Promise<any[]>((resolve) => {
    const stop = lobby.onMessage("rooms", (rooms: any[]) => {
      stop();
      resolve(rooms);
    });
  });
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

          // boot the driver to ensure table exists
          if (driver.boot) { await driver.boot(); }
          await driver.clear();

          // listen for testing
          await server.listen(TEST_PORT);
        });

        /**
         * ensure no rooms are avaialble in-between tests
         */
        afterEach(async () => {
          await server.gracefullyShutdown(false);
        });

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

        it("should not match a room without metadata against a metadata filter", async () => {
          await matchMaker.createRoom("dummy_1", {});

          const filter = { name: "dummy_1", metadata: { mode: "duel" } };
          const lobby = await createSDKClient().joinOrCreate("lobby");
          assert.strictEqual((await nextRooms(lobby)).length, 1);

          const refiltered = nextRooms(lobby);
          lobby.send("filter", filter);
          assert.deepStrictEqual(await refiltered, []);

          const joined = await createSDKClient().joinOrCreate("lobby", { filter });
          assert.deepStrictEqual(await nextRooms(joined), []);

          await Promise.all([lobby.leave(), joined.leave()]);
        });

        it("a metadata filter should not stop other clients receiving updates", async () => {
          const filter = { name: "dummy_1", metadata: { mode: "duel" } };
          const filtered = await createSDKClient().joinOrCreate("lobby", { filter });
          filtered.onMessage("*", () => {});

          const added: any[] = [];
          const unfiltered = await createSDKClient().joinOrCreate("lobby");
          unfiltered.onMessage("rooms", () => {});
          unfiltered.onMessage("+", (entry) => added.push(entry));

          await matchMaker.createRoom("dummy_1", {});
          await waitUntil(() => added.length > 0);
          assert.strictEqual(added[0]?.[1].name, "dummy_1");

          await Promise.all([filtered.leave(), unfiltered.leave()]);
        });

        it("a client that fails to receive an update should not skip the others", async () => {
          matchMaker.defineRoomType("faulty_lobby", class extends LobbyRoom {
            protected filterItemForClient(room: any, filter?: any) {
              if (filter?.name === "faulty") { throw new Error("faulty filter"); }
              return super.filterItemForClient(room, filter);
            }
          });

          const faulty = await createSDKClient().joinOrCreate("faulty_lobby", { filter: { name: "faulty" } });
          faulty.onMessage("*", () => {});

          const added: any[] = [];
          const healthy = await createSDKClient().joinOrCreate("faulty_lobby");
          healthy.onMessage("rooms", () => {});
          healthy.onMessage("+", (entry) => added.push(entry));

          await matchMaker.createRoom("dummy_1", {});
          await waitUntil(() => added.length > 0);
          assert.strictEqual(added[0]?.[1].name, "dummy_1");

          await Promise.all([faulty.leave(), healthy.leave()]);
        });

        it("updating metadata should not cause race condition", async () => {
          const onDisposeDeferred = new Deferred();

          matchMaker.defineRoomType("metadata_room", class _ extends Room {
            async onCreate(options: any) {
              await this.setMetadata({ field: "value 1" });
            }
            async onJoin() {
              await this.setMetadata({ field: "value 2" });
            }
            async onLeave() {
              await this.setMetadata({ field: "value " + Math.random() });
              await this.setMetadata({ field: "value " + Math.random() });
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

          await timeout(10);

          assert.strictEqual(1, lobby.rooms.length, "Room should be added to lobby list after metadata update");
          assert.strictEqual(lobby.rooms[0].metadata.field, "value 2", "Metadata should be set");

          clientRoom1.leave();
          clientRoom2.leave();

          await onDisposeDeferred;

          // Wait for lobby to receive the room removal notification
          await timeout(50);

          assert.strictEqual(0, lobby.rooms.length, "Room should be removed from lobby list after disposal");
        });
      });

    }
  }

});

import assert from "assert";
import { matchMaker, LobbyRoom, Presence, MatchMakerDriver, Server } from "../../src";
import { PRESENCE_IMPLEMENTATIONS, DRIVERS, DummyRoom, timeout } from "../utils";

const TEST_PORT = 8567;

async function createLobbyRoom () {
  const room = await matchMaker.createRoom("lobby", {});
  return matchMaker.getLocalRoomById(room.roomId) as LobbyRoom;
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

      });

    }
  }

});

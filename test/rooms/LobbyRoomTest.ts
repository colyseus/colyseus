import assert from "assert";
import { matchMaker, LobbyRoom } from "../../src";
import { PRESENCE_IMPLEMENTATIONS, DRIVERS, DummyRoom, timeout } from "../utils";

async function createLobbyRoom () {
  const room = await matchMaker.createRoom("lobby", {});
  return matchMaker.getRoomById(room.roomId) as LobbyRoom;
}

describe("LobbyRoom", () => {
  for (let i = 0; i < PRESENCE_IMPLEMENTATIONS.length; i++) {
    const presence = PRESENCE_IMPLEMENTATIONS[i];

    for (let j = 0; j < DRIVERS.length; j++) {
      const driver = DRIVERS[j];

      describe(`Driver => ${(driver.constructor as any).name}, Presence => ${presence.constructor.name}`, () => {
        /**
         * `setup` matchmaker to re-set graceful shutdown status
         */
        beforeEach(() => {
          matchMaker.setup(presence, driver, 'dummyProcessId')
          matchMaker.defineRoomType("lobby", LobbyRoom);
          matchMaker.defineRoomType("dummy_1", DummyRoom).enableRealtimeListing();
          matchMaker.defineRoomType("dummy_2", DummyRoom).enableRealtimeListing();
        });

        /**
         * ensure no rooms are avaialble in-between tests
         */
        afterEach(async () => await matchMaker.gracefullyShutdown());

        it("initial room list should be empty", async () => {
          const lobby = await createLobbyRoom();
          assert.equal(0, lobby.rooms.length);
        });

        it("inital room list should contain existing rooms", async () => {
          await matchMaker.create("dummy_1", {});
          await matchMaker.create("dummy_2", {});
          const lobby = await createLobbyRoom();
          assert.equal(2, lobby.rooms.length);
        });

        it("should receive update when room is created", async () => {
          const lobby = await createLobbyRoom();
          assert.equal(0, lobby.rooms.length);

          await matchMaker.createRoom("dummy_1", {});

          // wait a bit until LobbyRoom received the update
          await timeout(10);
          assert.equal(1, lobby.rooms.length);
        });

      });

    }
  }

});
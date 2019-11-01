import assert from "assert";
import { matchMaker, Room } from "../src";
import { DummyRoom, Room2Clients, createDummyClient, awaitForTimeout, ReconnectRoom, Room3Clients, RoomOnCreateException } from "./utils/mock";
import { LocalDriver } from "../src/matchmaker/drivers/LocalDriver";
import { MongooseDriver } from "../src/matchmaker/drivers/MongooseDriver";
import { DEFAULT_SEAT_RESERVATION_TIME } from "../src/Room";

const drivers = [
  new LocalDriver(),
  new MongooseDriver('mongodb://127.0.0.1:27017/colyseus_test'),
];

describe("MatchMaker", () => {

  /**
   * register room types
   */
  before(async () => {
    matchMaker.defineRoomType("dummy", DummyRoom);
    matchMaker.defineRoomType("room2", Room2Clients);
    matchMaker.defineRoomType("room3", Room3Clients);
    matchMaker.defineRoomType("reconnect", ReconnectRoom);
    matchMaker.defineRoomType("on_create_exception", RoomOnCreateException);

    /**
     * give some time for `cleanupStaleRooms()` to run
     */
    await awaitForTimeout(50);
  });

  for (let i=0; i<drivers.length; i++) {
    const driver = drivers[i];

    describe(`driver -> ${driver.constructor.name}`, () => {
      /**
       * `setup` matchmaker to re-set graceful shutdown status
       */
      beforeEach(() => matchMaker.setup(undefined, driver, 'dummyProcessId'));

      /**
       * ensure no rooms are avaialble in-between tests
       */
      afterEach(async () => await matchMaker.gracefullyShutdown());

      describe("exposed methods", () => {
        it("joinOrCreate() should create a new room", async () => {
          const reservedSeat = await matchMaker.joinOrCreate("dummy");
          const room = matchMaker.getRoomById(reservedSeat.room.roomId)
          assert.ok(room.hasReservedSeat(reservedSeat.sessionId));
          assert.ok(room instanceof Room);
          assert.ok(room instanceof DummyRoom);
        });

        it("joinOrCreate() should not find private rooms", async () => {
          const reservedSeat = await matchMaker.joinOrCreate("dummy");

          const room = matchMaker.getRoomById(reservedSeat.room.roomId)
          await room.setPrivate();

          const reservedSeat2 = await matchMaker.joinOrCreate("dummy");
          assert.notEqual(reservedSeat2.room.roomId, reservedSeat.room.roomId, "should not join a private room");
        });

        it("joinOrCreate() should not find locked rooms", async () => {
          const reservedSeat = await matchMaker.joinOrCreate("dummy");

          const room = matchMaker.getRoomById(reservedSeat.room.roomId)
          await room.lock();

          const reservedSeat2 = await matchMaker.joinOrCreate("dummy");
          assert.notEqual(reservedSeat2.room.roomId, reservedSeat.room.roomId, "should not join a locked room");
        });

        it("join() should fail if room doesn't exist", async () => {
          await assert.rejects(async () => await matchMaker.join("dummy"), /no rooms found/i);
        });

        it("join() should succeed if room exists", async () => {
          const reservedSeat1 = await matchMaker.joinOrCreate("dummy");

          const reservedSeat2 = await matchMaker.join("dummy");
          const room = matchMaker.getRoomById(reservedSeat2.room.roomId);

          assert.equal(reservedSeat1.room.roomId, reservedSeat2.room.roomId);
          assert.ok(room.hasReservedSeat(reservedSeat2.sessionId));
        });

        it("create() should create a new room", async () => {
          const reservedSeat1 = await matchMaker.joinOrCreate("dummy");
          const reservedSeat2 = await matchMaker.create("dummy");
          const room = matchMaker.getRoomById(reservedSeat2.room.roomId);

          assert.notEqual(reservedSeat1.room.roomId, reservedSeat2.room.roomId);
          assert.ok(reservedSeat2.room.roomId);
          assert.ok(room.hasReservedSeat(reservedSeat2.sessionId));
        });

        it("joinById() should allow to join a room by id", async () => {
          const reservedSeat1 = await matchMaker.create("room2");
          const reservedSeat2 = await matchMaker.joinById(reservedSeat1.room.roomId);
          const room = matchMaker.getRoomById(reservedSeat2.room.roomId);

          assert.equal(reservedSeat1.room.roomId, reservedSeat2.room.roomId);
          await assert.rejects(async () => await matchMaker.joinById(reservedSeat1.room.roomId), /locked/i);
          assert.ok(room.hasReservedSeat(reservedSeat2.sessionId));
        });
      });

      describe("query() for cached rooms", () => {
        it("should list all", async () => {
          // create 4 rooms
          for (let i = 0; i < 4; i++) {
            await matchMaker.create("dummy");
          }

          const rooms = await matchMaker.query({});
          assert.equal(4, rooms.length);
        });

        it("should list only public and unlocked rooms", async () => {
          // create 4 public rooms
          for (let i = 0; i < 4; i++) {
            await matchMaker.create("dummy");
          }

          // create 2 private rooms
          for (let i = 0; i < 2; i++) {
            const reservedSeat = await matchMaker.create("dummy");
            await matchMaker.remoteRoomCall(reservedSeat.room.roomId, "setPrivate");
          }

          //
          for (let i = 0; i < 2; i++) {
            const reservedSeat = await matchMaker.create("dummy");
            await matchMaker.remoteRoomCall(reservedSeat.room.roomId, "lock");
          }

          assert.equal(8, (await matchMaker.query({})).length);
          assert.equal(6, (await matchMaker.query({ private: false })).length);
          assert.equal(4, (await matchMaker.query({ private: false, locked: false })).length);
        });
      });

      describe("reconnect", async () => {
        it("should allow to reconnect", async () => {
          const reservedSeat1 = await matchMaker.joinOrCreate("reconnect");

          const client1 = createDummyClient(reservedSeat1);
          const room = matchMaker.getRoomById(reservedSeat1.room.roomId);
          await room._onJoin(client1 as any);

          assert.equal(1, room.clients.length);

          client1.close();
          await awaitForTimeout(100);

          let rooms = await matchMaker.query({});
          assert.equal(1, rooms.length);
          assert.equal(1, rooms[0].clients, "should keep seat reservation after disconnection");

          await matchMaker.joinById(room.roomId, { sessionId: client1.sessionId });
          await room._onJoin(client1 as any);

          rooms = await matchMaker.query({});
          assert.equal(1, rooms.length);
          assert.equal(1, rooms[0].clients);
          assert.equal(1, room.clients.length);
        });

        it("should not allow to reconnect", async () => {
          const reservedSeat1 = await matchMaker.joinOrCreate("reconnect");
          const reservedSeat2 = await matchMaker.joinOrCreate("reconnect");

          const client1 = createDummyClient(reservedSeat1);
          const room = matchMaker.getRoomById(reservedSeat1.room.roomId);
          await room._onJoin(client1 as any);

          /**
           * Create a second client so the room won't dispose
           */
          const client2 = createDummyClient(reservedSeat2);
          await room._onJoin(client2 as any);
          assert.equal(2, room.clients.length);

          client1.close();
          await awaitForTimeout(250);
          assert.equal(1, room.clients.length);

          await assert.rejects(async() => await matchMaker.joinById(room.roomId, { sessionId: client1.sessionId }), /expired/);
        });
      });

      // define the same tests using multiple drivers
      it("when `maxClients` is reached, the room should be locked", async () => {
        // first client joins
        const reservedSeat1 = await matchMaker.joinOrCreate("room3");
        const room = matchMaker.getRoomById(reservedSeat1.room.roomId);
        assert.equal(false, room.locked);

        // more 2 clients join
        await matchMaker.joinOrCreate("room3");
        await matchMaker.joinOrCreate("room3");

        const roomsBeforeExpiration = await matchMaker.query({});
        assert.equal(1, roomsBeforeExpiration.length);
        assert.equal(3, roomsBeforeExpiration[0].clients);
        assert.equal(true, room.locked);
        assert.equal(true, roomsBeforeExpiration[0].locked);
      });

      it("seat reservation should expire", async () => {
        const reservedSeat1 = await matchMaker.joinOrCreate("room3");
        const room = matchMaker.getRoomById(reservedSeat1.room.roomId);
        assert.equal(false, room.locked);

        // more 2 clients join
        await matchMaker.joinOrCreate("room3");
        await matchMaker.joinOrCreate("room3");

        const roomsBeforeExpiration = await matchMaker.query({});
        assert.equal(1, roomsBeforeExpiration.length);
        assert.equal(3, roomsBeforeExpiration[0].clients);
        assert.equal(true, roomsBeforeExpiration[0].locked);

        // only 1 client actually joins the room, 2 of them are going to expire
        await room._onJoin(createDummyClient(reservedSeat1) as any);

        await awaitForTimeout(DEFAULT_SEAT_RESERVATION_TIME * 1000);

        // connect 2 clients to the same room again
        await matchMaker.joinOrCreate("room3");
        await matchMaker.joinOrCreate("room3");
        const roomsAfterExpiration2 = await matchMaker.query({});
        assert.equal(1, roomsAfterExpiration2.length);
        assert.equal(3, roomsAfterExpiration2[0].clients);
        assert.equal(true, roomsAfterExpiration2[0].locked);
      });

      it("should automatically lock rooms", async () => {
        await matchMaker.joinOrCreate("room3");
        await matchMaker.joinOrCreate("room3");
        await matchMaker.joinOrCreate("room3");

        let rooms = await matchMaker.query({});
        assert.equal(1, rooms.length);
        assert.equal(3, rooms[0].clients);
        assert.equal(true, rooms[0].locked);

        await matchMaker.joinOrCreate("room3");
        rooms = await matchMaker.query({});
        assert.equal(2, rooms.length);
        assert.equal(3, rooms[0].clients);
        assert.equal(1, rooms[1].clients);
        assert.equal(true, rooms[0].locked);
        assert.equal(false, rooms[1].locked);
      });

      it("should allow to manually lock rooms", async () => {
        const reservedSeat1 = await matchMaker.joinOrCreate("room3");
        await matchMaker.remoteRoomCall(reservedSeat1.room.roomId, "lock");

        const reservedSeat2 = await matchMaker.joinOrCreate("room3");
        await matchMaker.remoteRoomCall(reservedSeat2.room.roomId, "lock");

        const reservedSeat3 = await matchMaker.joinOrCreate("room3");
        await matchMaker.remoteRoomCall(reservedSeat3.room.roomId, "lock");

        let rooms = await matchMaker.query({});
        assert.equal(3, rooms.length);
        assert.equal(true, rooms[0].locked);
        assert.equal(true, rooms[1].locked);
        assert.equal(true, rooms[2].locked);
      });

      describe("concurrency", async () => {
        it("should create 50 rooms", async () => {
          const numConnections = 100;

          const promises = [];
          for (let i = 0; i < numConnections; i++) {
            promises.push(new Promise(async (resolve, reject) => {
              try {
                const reservedSeat = await matchMaker.joinOrCreate("room2");
                const room = matchMaker.getRoomById(reservedSeat.room.roomId);
                await room._onJoin(createDummyClient(reservedSeat) as any);
                resolve();

              } catch (e) {
                reject();
              }
            }));
          }

          // await for all calls to be complete
          const results = await Promise.all(promises);
          assert.equal(100, results.length);

          const rooms = await matchMaker.query({});
          assert.equal(50, rooms.length);

          for (let i = 0; i < Math.floor(numConnections / 2); i++) {
            assert.equal(2, rooms[i].clients);
            assert.equal(true,rooms[i].locked);
          }
        });
      });

      // TODO: join 100 clients with low expiration time.
      // bug: it allows creating rooms with more clients than allowed

    });

  }

});
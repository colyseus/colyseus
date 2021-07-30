import assert from "assert";
import { matchMaker, MatchMakerDriver, Room } from "@colyseus/core";
import { DummyRoom, Room2Clients, createDummyClient, timeout, ReconnectRoom, Room3Clients, DRIVERS, ReconnectTokenRoom } from "./utils";

const DEFAULT_SEAT_RESERVATION_TIME = Number(process.env.COLYSEUS_SEAT_RESERVATION_TIME);

describe("MatchMaker", () => {
  for (let i = 0; i < DRIVERS.length; i++) {
    describe(`Driver: ${DRIVERS[i].name}`, () => {
      let driver: MatchMakerDriver;

      /**
       * register room types
       */
      before(async () => {
        driver = new DRIVERS[i]();
        matchMaker.setup(undefined, driver, 'dummyMatchMakerProcessId');

        matchMaker.defineRoomType("empty", DummyRoom);
        matchMaker.defineRoomType("dummy", DummyRoom);
        matchMaker.defineRoomType("room2", Room2Clients);
        matchMaker.defineRoomType("room3", Room3Clients);
        matchMaker.defineRoomType("reconnect", ReconnectRoom);
        matchMaker.defineRoomType("reconnect_token", ReconnectTokenRoom);

        matchMaker
          .defineRoomType("room2_filtered", Room2Clients)
          .filterBy(['mode']);

        matchMaker
          .defineRoomType("room3_sorted_desc", Room3Clients)
          .filterBy(['clients'])
          .sortBy({ clients: -1 });

        matchMaker
          .defineRoomType("room3_sorted_asc", Room3Clients)
          .filterBy(['clients'])
          .sortBy({ clients: 1 });

        /**
         * give some time for `cleanupStaleRooms()` to run
         */
        await timeout(50);
      });

      // make sure driver is cleared out.
      after(async() => await driver.clear());

      /**
       * `setup` matchmaker to re-set graceful shutdown status
       */
      beforeEach(() => matchMaker.setup(undefined, driver, 'dummyMatchMakerProcessId'));

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
          assert.notStrictEqual(reservedSeat2.room.roomId, reservedSeat.room.roomId, "should not join a private room");
        });

        it("joinOrCreate() should not find locked rooms", async () => {
          const reservedSeat = await matchMaker.joinOrCreate("dummy");

          const room = matchMaker.getRoomById(reservedSeat.room.roomId)
          await room.lock();

          const reservedSeat2 = await matchMaker.joinOrCreate("dummy");
          assert.notStrictEqual(reservedSeat2.room.roomId, reservedSeat.room.roomId, "should not join a locked room");
        });

        it("join() should fail if room doesn't exist", async () => {
          await assert.rejects(async () => await matchMaker.join("empty"), /no rooms found/i);
        });

        it("join() should succeed if room exists", async () => {
          const reservedSeat1 = await matchMaker.joinOrCreate("dummy");

          const reservedSeat2 = await matchMaker.join("dummy");
          const room = matchMaker.getRoomById(reservedSeat2.room.roomId);

          assert.strictEqual(reservedSeat1.room.roomId, reservedSeat2.room.roomId);
          assert.ok(room.hasReservedSeat(reservedSeat2.sessionId));
        });

        it("create() should create a new room", async () => {
          const reservedSeat1 = await matchMaker.joinOrCreate("dummy");
          const reservedSeat2 = await matchMaker.create("dummy");
          const room = matchMaker.getRoomById(reservedSeat2.room.roomId);

          assert.notStrictEqual(reservedSeat1.room.roomId, reservedSeat2.room.roomId);
          assert.ok(reservedSeat2.room.roomId);
          assert.ok(room.hasReservedSeat(reservedSeat2.sessionId));
        });

        it("joinById() should allow to join a room by id", async () => {
          const reservedSeat1 = await matchMaker.create("room2");
          const reservedSeat2 = await matchMaker.joinById(reservedSeat1.room.roomId);
          const room = matchMaker.getRoomById(reservedSeat2.room.roomId);

          assert.strictEqual(reservedSeat1.room.roomId, reservedSeat2.room.roomId);
          assert.ok(room.hasReservedSeat(reservedSeat2.sessionId));
        });

        it("joinById() should not allow to join a locked room", async () => {
          const reservedSeat1 = await matchMaker.create("room2");
          await matchMaker.joinById(reservedSeat1.room.roomId);
          await assert.rejects(async () => await matchMaker.joinById(reservedSeat1.room.roomId), /locked/i);
        });

        it("joinById() should allow to join a private room", async () => {
          const reservedSeat1 = await matchMaker.create("room2");
          const room = matchMaker.getRoomById(reservedSeat1.room.roomId);
          await room.setPrivate();

          const reservedSeat2 = await matchMaker.joinById(reservedSeat1.room.roomId)
          assert.strictEqual(reservedSeat1.room.roomId, reservedSeat2.room.roomId);
        });

        it("should throw error trying to create a room not defined", async () => {
          await assert.rejects(async () => await matchMaker.joinOrCreate("non_existing_room"), /not defined/i);
          await assert.rejects(async () => await matchMaker.create("non_existing_room"), /not defined/i);
        });

        it("filterBy(): filter by 'mode' field", async () => {
          const reservedSeat1 = await matchMaker.joinOrCreate("room2_filtered", { mode: "squad" });
          const reservedSeat2 = await matchMaker.joinOrCreate("room2_filtered", { mode: "duo" });
          assert.notStrictEqual(reservedSeat1.room.roomId, reservedSeat2.room.roomId);

          const reservedSeat3 = await matchMaker.joinOrCreate("room2_filtered", { mode: "squad" });
          const reservedSeat4 = await matchMaker.joinOrCreate("room2_filtered", { mode: "duo" });
          assert.strictEqual(reservedSeat1.room.roomId, reservedSeat3.room.roomId);
          assert.strictEqual(reservedSeat2.room.roomId, reservedSeat4.room.roomId);
        });

        it("sortBy(): sort desc by 'clients' field", async () => {
          await matchMaker.createRoom("room3_sorted_desc", { roomId: "aaa" });
          await matchMaker.createRoom("room3_sorted_desc", { roomId: "bbb" });
          await matchMaker.createRoom("room3_sorted_desc", { roomId: "ccc" });

          // The RedisDriver do not rely on insertion order when querying for rooms.
          const roomsCachedOrder = await matchMaker.query({});

          const reservedSeat1 = await matchMaker.join("room3_sorted_desc");
          assert.strictEqual(roomsCachedOrder[0].roomId, reservedSeat1.room.roomId);

          const reservedSeat2 = await matchMaker.join("room3_sorted_desc");
          assert.strictEqual(roomsCachedOrder[0].roomId, reservedSeat2.room.roomId);

          const reservedSeat3 = await matchMaker.join("room3_sorted_desc");
          assert.strictEqual(roomsCachedOrder[0].roomId, reservedSeat3.room.roomId);

          const reservedSeat4 = await matchMaker.join("room3_sorted_desc");
          assert.strictEqual(roomsCachedOrder[1].roomId, reservedSeat4.room.roomId);

          const reservedSeat5 = await matchMaker.join("room3_sorted_desc");
          assert.strictEqual(roomsCachedOrder[1].roomId, reservedSeat5.room.roomId);

          const reservedSeat6 = await matchMaker.join("room3_sorted_desc");
          assert.strictEqual(roomsCachedOrder[1].roomId, reservedSeat6.room.roomId);

          const reservedSeat7 = await matchMaker.join("room3_sorted_desc");
          assert.strictEqual(roomsCachedOrder[2].roomId, reservedSeat7.room.roomId);

          const reservedSeat8 = await matchMaker.join("room3_sorted_desc");
          assert.strictEqual(roomsCachedOrder[2].roomId, reservedSeat8.room.roomId);

          const reservedSeat9 = await matchMaker.join("room3_sorted_desc");
          assert.strictEqual(roomsCachedOrder[2].roomId, reservedSeat9.room.roomId);
        });

        it("sortBy(): sort asc by 'clients' field", async () => {
          await matchMaker.createRoom("room3_sorted_asc", { roomId: "aaa" });
          await matchMaker.createRoom("room3_sorted_asc", { roomId: "bbb" });
          await matchMaker.createRoom("room3_sorted_asc", { roomId: "ccc" });

          // The RedisDriver do not rely on insertion order when querying for rooms.
          const roomsCachedOrder = await matchMaker.query({});

          const reservedSeat1 = await matchMaker.join("room3_sorted_asc");
          assert.strictEqual(roomsCachedOrder[0].roomId, reservedSeat1.room.roomId);

          const reservedSeat2 = await matchMaker.join("room3_sorted_asc");
          assert.strictEqual(roomsCachedOrder[1].roomId, reservedSeat2.room.roomId);

          const reservedSeat3 = await matchMaker.join("room3_sorted_asc");
          assert.strictEqual(roomsCachedOrder[2].roomId, reservedSeat3.room.roomId);

          const reservedSeat4 = await matchMaker.join("room3_sorted_asc");
          assert.strictEqual(roomsCachedOrder[0].roomId, reservedSeat4.room.roomId);

          const reservedSeat5 = await matchMaker.join("room3_sorted_asc");
          assert.strictEqual(roomsCachedOrder[1].roomId, reservedSeat5.room.roomId);

          const reservedSeat6 = await matchMaker.join("room3_sorted_asc");
          assert.strictEqual(roomsCachedOrder[2].roomId, reservedSeat6.room.roomId);

          const reservedSeat7 = await matchMaker.join("room3_sorted_asc");
          assert.strictEqual(roomsCachedOrder[0].roomId, reservedSeat7.room.roomId);

          const reservedSeat8 = await matchMaker.join("room3_sorted_asc");
          assert.strictEqual(roomsCachedOrder[1].roomId, reservedSeat8.room.roomId);

          const reservedSeat9 = await matchMaker.join("room3_sorted_asc");
          assert.strictEqual(roomsCachedOrder[2].roomId, reservedSeat9.room.roomId);
        });
      });

      describe("query() for cached rooms", () => {
        it("should list all", async () => {
          // create 4 rooms
          for (let i = 0; i < 4; i++) {
            await matchMaker.create("dummy");
          }

          const rooms = await matchMaker.query({});
          assert.strictEqual(4, rooms.length);
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

          assert.strictEqual(8, (await matchMaker.query({})).length);
          assert.strictEqual(6, (await matchMaker.query({ private: false })).length);
          assert.strictEqual(4, (await matchMaker.query({ private: false, locked: false })).length);
        });
      });

      describe("reconnect", async () => {
        it("should allow to reconnect", async () => {
          const reservedSeat1 = await matchMaker.joinOrCreate("reconnect");

          const client1 = createDummyClient(reservedSeat1);
          const room = matchMaker.getRoomById(reservedSeat1.room.roomId);
          await room._onJoin(client1 as any);

          assert.strictEqual(1, room.clients.length);

          client1.close();
          await timeout(100);

          let rooms = await matchMaker.query({});
          assert.strictEqual(1, rooms.length);
          assert.strictEqual(1, rooms[0].clients, "should keep seat reservation after disconnection");

          await matchMaker.joinById(room.roomId, { sessionId: client1.sessionId });
          await room._onJoin(client1 as any);

          rooms = await matchMaker.query({});
          assert.strictEqual(1, rooms.length);
          assert.strictEqual(1, rooms[0].clients);
          assert.strictEqual(1, room.clients.length);

          client1.close();
          await timeout(100);
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
          assert.strictEqual(2, room.clients.length);

          client1.close();
          await timeout(250);
          assert.strictEqual(1, room.clients.length);

          await assert.rejects(async() => await matchMaker.joinById(room.roomId, { sessionId: client1.sessionId }), /expired/);
        });

        it("using token: should allow to reconnect", async () => {
          const reservedSeat1 = await matchMaker.joinOrCreate("reconnect_token");

          const client1 = createDummyClient(reservedSeat1);
          const room = matchMaker.getRoomById(reservedSeat1.room.roomId) as ReconnectTokenRoom;
          await room._onJoin(client1 as any);

          assert.strictEqual(1, room.clients.length);

          client1.close();
          await timeout(100);

          let rooms = await matchMaker.query({});
          assert.strictEqual(1, rooms.length);
          assert.strictEqual(1, rooms[0].clients, "should keep seat reservation after disconnection");

          await matchMaker.joinById(room.roomId, { sessionId: client1.sessionId });
          await room._onJoin(client1 as any);

          rooms = await matchMaker.query({});
          assert.strictEqual(1, rooms.length);
          assert.strictEqual(1, rooms[0].clients);
          assert.strictEqual(1, room.clients.length);

          client1.close();
          await timeout(100);
        });

        it("using token: should not allow to reconnect", async () => {
          const reservedSeat1 = await matchMaker.joinOrCreate("reconnect_token");
          const reservedSeat2 = await matchMaker.joinOrCreate("reconnect_token");

          const client1 = createDummyClient(reservedSeat1);
          const room = matchMaker.getRoomById(reservedSeat1.room.roomId) as ReconnectTokenRoom;
          await room._onJoin(client1 as any);

          /**
           * Create a second client so the room won't dispose
           */
          const client2 = createDummyClient(reservedSeat2);
          await room._onJoin(client2 as any);
          assert.strictEqual(2, room.clients.length);

          client1.close();

          await timeout(100);

          room.token.reject();
          await timeout(100);

          assert.strictEqual(1, room.clients.length);

          await assert.rejects(async() => await matchMaker.joinById(room.roomId, { sessionId: client1.sessionId }), /expired/);
        });

      });

      // define the same tests using multiple drivers
      it("when `maxClients` is reached, the room should be locked", async () => {
        // first client joins
        const reservedSeat1 = await matchMaker.joinOrCreate("room3");
        const room = matchMaker.getRoomById(reservedSeat1.room.roomId);
        assert.strictEqual(false, room.locked);

        // more 2 clients join
        await matchMaker.joinOrCreate("room3");
        await matchMaker.joinOrCreate("room3");

        const roomsBeforeExpiration = await matchMaker.query({});
        assert.strictEqual(1, roomsBeforeExpiration.length);
        assert.strictEqual(3, roomsBeforeExpiration[0].clients);
        assert.strictEqual(true, room.locked);
        assert.strictEqual(true, roomsBeforeExpiration[0].locked);
      });

      it("seat reservation should expire", async () => {
        const reservedSeat1 = await matchMaker.joinOrCreate("room3");
        const room = matchMaker.getRoomById(reservedSeat1.room.roomId);
        assert.strictEqual(false, room.locked);

        // more 2 clients join
        await matchMaker.joinOrCreate("room3");
        await matchMaker.joinOrCreate("room3");

        const roomsBeforeExpiration = await matchMaker.query({});
        assert.strictEqual(1, roomsBeforeExpiration.length);
        assert.strictEqual(3, roomsBeforeExpiration[0].clients);
        assert.strictEqual(true, roomsBeforeExpiration[0].locked);

        // only 1 client actually joins the room, 2 of them are going to expire
        await room._onJoin(createDummyClient(reservedSeat1) as any);

        await timeout(DEFAULT_SEAT_RESERVATION_TIME * 1100);

        // connect 2 clients to the same room again
        await matchMaker.joinOrCreate("room3");
        await matchMaker.joinOrCreate("room3");
        const roomsAfterExpiration2 = await matchMaker.query({});
        assert.strictEqual(1, roomsAfterExpiration2.length);
        assert.strictEqual(3, roomsAfterExpiration2[0].clients);
        assert.strictEqual(true, roomsAfterExpiration2[0].locked);
      });

      it("should automatically lock rooms", async () => {
        const _firstRoom = await matchMaker.joinOrCreate("room3");
        await matchMaker.joinOrCreate("room3");
        await matchMaker.joinOrCreate("room3");

        let rooms = await matchMaker.query({});
        assert.strictEqual(1, rooms.length);
        assert.strictEqual(3, rooms[0].clients);
        assert.strictEqual(true, rooms[0].locked);

        const _secondRoom = await matchMaker.joinOrCreate("room3");
        rooms = await matchMaker.query({});

        const firstRoom = rooms.find((r) => r.roomId === _firstRoom.room.roomId);
        const secondRoom = rooms.find((r) => r.roomId === _secondRoom.room.roomId);
        assert.strictEqual(2, rooms.length);
        assert.strictEqual(3, firstRoom.clients);
        assert.strictEqual(1, secondRoom.clients);
        assert.strictEqual(true, firstRoom.locked);
        assert.strictEqual(false, secondRoom.locked);
      });

      it("should allow to manually lock rooms", async () => {
        const reservedSeat1 = await matchMaker.joinOrCreate("room3");
        await matchMaker.remoteRoomCall(reservedSeat1.room.roomId, "lock");

        const reservedSeat2 = await matchMaker.joinOrCreate("room3");
        await matchMaker.remoteRoomCall(reservedSeat2.room.roomId, "lock");

        const reservedSeat3 = await matchMaker.joinOrCreate("room3");
        await matchMaker.remoteRoomCall(reservedSeat3.room.roomId, "lock");

        let rooms = await matchMaker.query({});
        assert.strictEqual(3, rooms.length);
        assert.strictEqual(true, rooms[0].locked);
        assert.strictEqual(true, rooms[1].locked);
        assert.strictEqual(true, rooms[2].locked);
      });

      describe("concurrency", async () => {
        it("should create 50 rooms", async () => {
          const numConnections = 100;

          const promises = [];
          for (let i = 0; i < numConnections; i++) {
            promises.push(new Promise<void>(async (resolve, reject) => {
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
          assert.strictEqual(100, results.length);

          const rooms = await matchMaker.query({});
          assert.strictEqual(50, rooms.length);

          for (let i = 0; i < Math.floor(numConnections / 2); i++) {
            assert.strictEqual(2, rooms[i].clients);
            assert.strictEqual(true,rooms[i].locked);
          }
        });
      });
    });

  }

});
import assert, { match } from "assert";
import { Deferred, generateId, matchMaker, Room, setDevMode, subscribeIPC, type MatchMakerDriver, type IRoomCache, initializeRoomCache } from "@colyseus/core";
import { DummyRoom, Room2Clients, createDummyClient, timeout, ReconnectRoom, Room3Clients, DRIVERS, ReconnectTokenRoom } from "./utils/index.ts";

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
        matchMaker.setup(undefined, driver);

        // boot the driver if implemented
        if (driver.boot) { await driver.boot(); }

        matchMaker.defineRoomType("empty", DummyRoom);
        matchMaker.defineRoomType("dummy", DummyRoom);
        matchMaker.defineRoomType("room2", Room2Clients);
        matchMaker.defineRoomType("room3", Room3Clients);
        matchMaker.defineRoomType("reconnect", ReconnectRoom);
        matchMaker.defineRoomType("reconnect_token", ReconnectTokenRoom);

        // a room name that is also an Object.prototype key (see "room names
        // colliding with Object.prototype keys" below)
        matchMaker.defineRoomType("isPrototypeOf", DummyRoom);

        matchMaker
          .defineRoomType("room2_filtered", Room2Clients)
          .filterBy(['mode'])

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

      // make sure driver is cleared out and shutdown.
      after(async() => {
        await driver.clear();
        await driver.shutdown();
      });

      /**
       * `setup` matchmaker to re-set graceful shutdown status
       */
      beforeEach(async () => {
        await driver.clear();
        await matchMaker.setup(undefined, driver);
        await matchMaker.accept();
      });

      /**
       * ensure no rooms are avaialble in-between tests
       */
      afterEach(async () => await matchMaker.gracefullyShutdown());

      describe("exposed methods", () => {
        it("joinOrCreate() should create a new room", async () => {
          const reservedSeat = await matchMaker.joinOrCreate("dummy");
          const room = matchMaker.getLocalRoomById(reservedSeat.roomId)
          assert.ok(room.hasReservedSeat(reservedSeat.sessionId));
          assert.ok(room instanceof Room);
          assert.ok(room instanceof DummyRoom);
        });

        it("joinOrCreate() should not find private rooms", async () => {
          const reservedSeat = await matchMaker.joinOrCreate("dummy");

          const room = matchMaker.getLocalRoomById(reservedSeat.roomId)
          await room.setPrivate();

          const reservedSeat2 = await matchMaker.joinOrCreate("dummy");
          assert.notStrictEqual(reservedSeat2.roomId, reservedSeat.roomId, "should not join a private room");
        });

        it("joinOrCreate() should not find locked rooms", async () => {
          const reservedSeat = await matchMaker.joinOrCreate("dummy");

          const room = matchMaker.getLocalRoomById(reservedSeat.roomId)
          await room.lock();

          const reservedSeat2 = await matchMaker.joinOrCreate("dummy");
          assert.notStrictEqual(reservedSeat2.roomId, reservedSeat.roomId, "should not join a locked room");
        });

        it("join() should fail if room doesn't exist", async () => {
          await assert.rejects(async () => await matchMaker.join("empty"), /no rooms found/i);
        });

        it("join() should succeed if room exists", async () => {
          const reservedSeat1 = await matchMaker.joinOrCreate("dummy");

          const reservedSeat2 = await matchMaker.join("dummy");
          const room = matchMaker.getLocalRoomById(reservedSeat2.roomId);

          assert.strictEqual(reservedSeat1.roomId, reservedSeat2.roomId);
          assert.ok(room.hasReservedSeat(reservedSeat2.sessionId));
        });

        it("create() should create a new room", async () => {
          const reservedSeat1 = await matchMaker.joinOrCreate("dummy");
          const reservedSeat2 = await matchMaker.create("dummy");
          const room = matchMaker.getLocalRoomById(reservedSeat2.roomId);

          assert.notStrictEqual(reservedSeat1.roomId, reservedSeat2.roomId);
          assert.ok(reservedSeat2.roomId);
          assert.ok(room.hasReservedSeat(reservedSeat2.sessionId));
        });

        it("joinById() should allow to join a room by id", async () => {
          const reservedSeat1 = await matchMaker.create("room2");
          const reservedSeat2 = await matchMaker.joinById(reservedSeat1.roomId);
          const room = matchMaker.getLocalRoomById(reservedSeat2.roomId);

          assert.strictEqual(reservedSeat1.roomId, reservedSeat2.roomId);
          assert.ok(room.hasReservedSeat(reservedSeat2.sessionId));
        });

        it("joinById() should not allow to join a locked room", async () => {
          const reservedSeat1 = await matchMaker.create("room2");
          await matchMaker.joinById(reservedSeat1.roomId);
          await assert.rejects(async () => await matchMaker.joinById(reservedSeat1.roomId), /locked/i);
        });

        it("joinById() should allow to join a private room", async () => {
          const reservedSeat1 = await matchMaker.create("room2");
          const room = matchMaker.getLocalRoomById(reservedSeat1.roomId);
          await room.setPrivate();

          const reservedSeat2 = await matchMaker.joinById(reservedSeat1.roomId)
          assert.strictEqual(reservedSeat1.roomId, reservedSeat2.roomId);
        });

        it("should throw error trying to create a room not defined", async () => {
          await assert.rejects(async () => await matchMaker.joinOrCreate("non_existing_room"), /not defined/i);
          await assert.rejects(async () => await matchMaker.create("non_existing_room"), /not defined/i);
        });

        it("create() should dispose the room when onCreate() throws", async () => {
          let ticks = 0;
          let messages = 0;
          let disposed = false;

          matchMaker.defineRoomType("failing_on_create", class extends Room {
            onCreate() {
              this.autoDispose = false; // so the auto-dispose timer can't mask the leak
              this.clock.setInterval(() => ticks++, 10);
              this.presence.subscribe("failing_on_create", () => messages++);
              throw new Error("onCreate failed");
            }
            onDispose() { disposed = true; }
          });

          await assert.rejects(async () => await matchMaker.create("failing_on_create"), /onCreate failed/);
          assert.ok(disposed, "onDispose() should run, to release what onCreate() acquired");

          await matchMaker.presence.publish("failing_on_create", "ping");
          await timeout(100);
          assert.strictEqual(ticks, 0, "clock should stop ticking");
          assert.strictEqual(messages, 0, "presence subscription should be released");
        });

        it("filterBy(): filter by 'mode' field", async () => {
          const reservedSeat1 = await matchMaker.joinOrCreate("room2_filtered", { mode: "squad" });
          const reservedSeat2 = await matchMaker.joinOrCreate("room2_filtered", { mode: "duo" });
          assert.notStrictEqual(reservedSeat1.roomId, reservedSeat2.roomId);

          const reservedSeat3 = await matchMaker.joinOrCreate("room2_filtered", { mode: "squad" });
          const reservedSeat4 = await matchMaker.joinOrCreate("room2_filtered", { mode: "duo" });
          assert.strictEqual(reservedSeat1.roomId, reservedSeat3.roomId);
          assert.strictEqual(reservedSeat2.roomId, reservedSeat4.roomId);
        });

        it("sortBy(): sort desc by 'clients' field", async () => {
          await matchMaker.createRoom("room3_sorted_desc", { roomId: "aaa" });
          await matchMaker.createRoom("room3_sorted_desc", { roomId: "bbb" });
          await matchMaker.createRoom("room3_sorted_desc", { roomId: "ccc" });

          // The RedisDriver do not rely on insertion order when querying for rooms.
          const roomsCachedOrder = await matchMaker.query({});

          const reservedSeat1 = await matchMaker.join("room3_sorted_desc");
          assert.strictEqual(roomsCachedOrder[0].roomId, reservedSeat1.roomId);

          const reservedSeat2 = await matchMaker.join("room3_sorted_desc");
          assert.strictEqual(roomsCachedOrder[0].roomId, reservedSeat2.roomId);

          const reservedSeat3 = await matchMaker.join("room3_sorted_desc");
          assert.strictEqual(roomsCachedOrder[0].roomId, reservedSeat3.roomId);

          const reservedSeat4 = await matchMaker.join("room3_sorted_desc");
          assert.strictEqual(roomsCachedOrder[1].roomId, reservedSeat4.roomId);

          const reservedSeat5 = await matchMaker.join("room3_sorted_desc");
          assert.strictEqual(roomsCachedOrder[1].roomId, reservedSeat5.roomId);

          const reservedSeat6 = await matchMaker.join("room3_sorted_desc");
          assert.strictEqual(roomsCachedOrder[1].roomId, reservedSeat6.roomId);

          const reservedSeat7 = await matchMaker.join("room3_sorted_desc");
          assert.strictEqual(roomsCachedOrder[2].roomId, reservedSeat7.roomId);

          const reservedSeat8 = await matchMaker.join("room3_sorted_desc");
          assert.strictEqual(roomsCachedOrder[2].roomId, reservedSeat8.roomId);

          const reservedSeat9 = await matchMaker.join("room3_sorted_desc");
          assert.strictEqual(roomsCachedOrder[2].roomId, reservedSeat9.roomId);
        });

        it("sortBy(): sort asc by 'clients' field", async () => {
          await matchMaker.createRoom("room3_sorted_asc", { roomId: "aaa" });
          await matchMaker.createRoom("room3_sorted_asc", { roomId: "bbb" });
          await matchMaker.createRoom("room3_sorted_asc", { roomId: "ccc" });

          // The RedisDriver do not rely on insertion order when querying for rooms.
          const roomsCachedOrder = await matchMaker.query({});

          const reservedSeat1 = await matchMaker.join("room3_sorted_asc");
          assert.strictEqual(roomsCachedOrder[0].roomId, reservedSeat1.roomId);

          const reservedSeat2 = await matchMaker.join("room3_sorted_asc");
          assert.strictEqual(roomsCachedOrder[1].roomId, reservedSeat2.roomId);

          const reservedSeat3 = await matchMaker.join("room3_sorted_asc");
          assert.strictEqual(roomsCachedOrder[2].roomId, reservedSeat3.roomId);

          const reservedSeat4 = await matchMaker.join("room3_sorted_asc");
          assert.strictEqual(roomsCachedOrder[0].roomId, reservedSeat4.roomId);

          const reservedSeat5 = await matchMaker.join("room3_sorted_asc");
          assert.strictEqual(roomsCachedOrder[1].roomId, reservedSeat5.roomId);

          const reservedSeat6 = await matchMaker.join("room3_sorted_asc");
          assert.strictEqual(roomsCachedOrder[2].roomId, reservedSeat6.roomId);

          const reservedSeat7 = await matchMaker.join("room3_sorted_asc");
          assert.strictEqual(roomsCachedOrder[0].roomId, reservedSeat7.roomId);

          const reservedSeat8 = await matchMaker.join("room3_sorted_asc");
          assert.strictEqual(roomsCachedOrder[1].roomId, reservedSeat8.roomId);

          const reservedSeat9 = await matchMaker.join("room3_sorted_asc");
          assert.strictEqual(roomsCachedOrder[2].roomId, reservedSeat9.roomId);
        });
      });

      //
      // Room names are client-supplied strings used as keys into the handler
      // registry. While that was a plain object, these names resolved to inherited
      // `Object.prototype` members instead of missing.
      // https://github.com/colyseus/colyseus/issues/951
      //
      describe("room names colliding with Object.prototype keys", () => {
        const PROTO_KEYS = ["__proto__", "constructor", "toString", "valueOf", "hasOwnProperty"];

        it("should report an undefined room name as such", async () => {
          for (const roomName of PROTO_KEYS) {
            await assert.rejects(
              async () => await matchMaker.joinOrCreate(roomName),
              /not defined/i,
              `unexpected error for room name "${roomName}"`,
            );
          }
        });

        it("should allow a room to be defined under one of those names", async () => {
          const reservedSeat = await matchMaker.joinOrCreate("isPrototypeOf");
          const room = matchMaker.getLocalRoomById(reservedSeat.roomId);
          assert.ok(room.hasReservedSeat(reservedSeat.sessionId));
          assert.ok(room instanceof DummyRoom);
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
            await matchMaker.remoteRoomCall(reservedSeat.roomId, "setPrivate");
          }

          //
          for (let i = 0; i < 2; i++) {
            const reservedSeat = await matchMaker.create("dummy");
            await matchMaker.remoteRoomCall(reservedSeat.roomId, "lock");
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
          const room = matchMaker.getLocalRoomById(reservedSeat1.roomId);
          await client1.confirmJoinRoom(room);

          assert.strictEqual(1, room.clients.length);

          client1.close();
          await timeout(100);

          let rooms = await matchMaker.query({});
          assert.strictEqual(1, rooms.length);
          assert.strictEqual(1, rooms[0].clients, "should keep seat reservation after disconnection");

          await matchMaker.reconnect(room.roomId, { reconnectionToken: client1.reconnectionToken });
          await createDummyClient(reservedSeat1).confirmJoinRoom(room, client1.reconnectionToken);

          rooms = await matchMaker.query({});
          assert.strictEqual(1, rooms.length);
          assert.strictEqual(1, rooms[0].clients);
          assert.strictEqual(1, room.clients.length);

          client1.close();
          await timeout(100);
        });

        it("room should be disposed on reconnection timeout", async () => {
          const reservedSeat1 = await matchMaker.joinOrCreate("reconnect");
          const client1 = createDummyClient(reservedSeat1);
          const room = matchMaker.getLocalRoomById(reservedSeat1.roomId);
          await client1.confirmJoinRoom(room);

          const reservedSeat2 = await matchMaker.joinOrCreate("reconnect");
          const client2 = createDummyClient(reservedSeat2);
          await client2.confirmJoinRoom(room);

          assert.strictEqual(2, room.clients.length);

          client1.terminate();
          client2.terminate();
          await timeout(1300); // resetAutoDisposeTimeout is 1000ms by default

          assert.strictEqual(0, matchMaker.stats.local.ccu);
          assert.strictEqual(0, matchMaker.stats.local.roomCount);

          let rooms = await matchMaker.query({});
          assert.strictEqual(0, rooms.length, "should have disposed room if client did not reconnected.");
        });

        it("should not allow to reconnect", async () => {
          const reservedSeat1 = await matchMaker.joinOrCreate("reconnect");
          const reservedSeat2 = await matchMaker.joinOrCreate("reconnect");

          const client1 = createDummyClient(reservedSeat1);
          const room = matchMaker.getLocalRoomById(reservedSeat1.roomId);
          await client1.confirmJoinRoom(room);

          /**
           * Create a second client so the room won't dispose
           */
          const client2 = createDummyClient(reservedSeat2);
          await client2.confirmJoinRoom(room);
          assert.strictEqual(2, room.clients.length);

          client1.close();
          await timeout(250);
          assert.strictEqual(1, room.clients.length);

          await assert.rejects(async () => await matchMaker.reconnect(room.roomId, {
            reconnectionToken: client1.reconnectionToken
          }), /expired/);
        });

        it("using token: should allow to reconnect", async () => {
          const reservedSeat1 = await matchMaker.joinOrCreate("reconnect_token");

          const client1 = createDummyClient(reservedSeat1);
          const room = matchMaker.getLocalRoomById(reservedSeat1.roomId) as ReconnectTokenRoom;
          await client1.confirmJoinRoom(room);

          assert.strictEqual(1, room.clients.length);

          client1.close();
          await timeout(100);

          let rooms = await matchMaker.query({});
          assert.strictEqual(1, rooms.length);
          assert.strictEqual(1, rooms[0].clients, "should keep seat reservation after disconnection");

          await matchMaker.reconnect(room.roomId, { reconnectionToken: client1.reconnectionToken });
          const reconnectingClient = createDummyClient(reservedSeat1);
          await reconnectingClient.confirmJoinRoom(room, client1.reconnectionToken);

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
          const room = matchMaker.getLocalRoomById(reservedSeat1.roomId) as ReconnectTokenRoom;
          await client1.confirmJoinRoom(room);

          /**
           * Create a second client so the room won't dispose
           */
          const client2 = createDummyClient(reservedSeat2);
          await client2.confirmJoinRoom(room);
          assert.strictEqual(2, room.clients.length);

          client1.close();

          await timeout(100);

          room.token.reject();
          await timeout(100);

          assert.strictEqual(1, room.clients.length);

          await assert.rejects(async() => await matchMaker.reconnect(room.roomId, { reconnectionToken: client1.reconnectionToken }), /expired/);
        });

      });

      describe("maxClients", () => {
        it("when `maxClients` is reached, the room should be locked", async () => {
          // first client joins
          const reservedSeat1 = await matchMaker.joinOrCreate("room3");
          const room = matchMaker.getLocalRoomById(reservedSeat1.roomId);
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

        it("maxClients: updating after room creation should change locked status", async () => {
          matchMaker.defineRoomType("maxClients", class extends Room {
            maxClients = 2;
          });

          const reservedSeat1 = await matchMaker.joinOrCreate("maxClients");
          const room = matchMaker.getLocalRoomById(reservedSeat1.roomId);
          assert.strictEqual(false, room.locked);

          // join another, room should be locked
          await matchMaker.joinOrCreate("maxClients");

          let rooms = await matchMaker.query({});
          assert.strictEqual(1, rooms.length);
          assert.strictEqual(2, rooms[0].clients);
          assert.strictEqual(true, room.locked);
          assert.strictEqual(true, rooms[0].locked);

          // change maxClients, room should be unlocked
          room.maxClients = 3;
          await timeout(20); // wait for async persist to complete

          rooms = await matchMaker.query({});
          assert.strictEqual(false, room.locked);
          assert.strictEqual(false, rooms[0].locked);

          // change maxClients, room should be locked again
          room.maxClients = 2;
          await timeout(20); // wait for async persist to complete

          rooms = await matchMaker.query({});
          assert.strictEqual(true, room.locked);
          assert.strictEqual(true, rooms[0].locked);
        });
      });

      it("seat reservation should expire", async () => {
        const reservedSeat1 = await matchMaker.joinOrCreate("room3");
        const room = matchMaker.getLocalRoomById(reservedSeat1.roomId);
        assert.strictEqual(false, room.locked);

        // more 2 clients join
        await matchMaker.joinOrCreate("room3");
        await matchMaker.joinOrCreate("room3");

        const roomsBeforeExpiration = await matchMaker.query({});
        assert.strictEqual(1, roomsBeforeExpiration.length);
        assert.strictEqual(3, roomsBeforeExpiration[0].clients);
        assert.strictEqual(true, roomsBeforeExpiration[0].locked);

        // only 1 client actually joins the room, 2 of them are going to expire
        await createDummyClient(reservedSeat1).confirmJoinRoom(room);

        await timeout(DEFAULT_SEAT_RESERVATION_TIME * 1100);

        // connect 2 clients to the same room again
        await matchMaker.joinOrCreate("room3");
        await matchMaker.joinOrCreate("room3");
        const roomsAfterExpiration2 = await matchMaker.query({});
        assert.strictEqual(1, roomsAfterExpiration2.length);
        assert.strictEqual(3, roomsAfterExpiration2[0].clients);
        assert.strictEqual(true, roomsAfterExpiration2[0].locked);
      });

      describe("locking rooms", () => {
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

          const firstRoom = rooms.find((r) => r.roomId === _firstRoom.roomId)!;
          const secondRoom = rooms.find((r) => r.roomId === _secondRoom.roomId)!;
          assert.strictEqual(2, rooms.length);
          assert.strictEqual(3, firstRoom.clients);
          assert.strictEqual(1, secondRoom.clients);
          assert.strictEqual(true, firstRoom.locked);
          assert.strictEqual(false, secondRoom.locked);
        });

        it("should allow to manually lock rooms", async () => {
          const reservedSeat1 = await matchMaker.joinOrCreate("room3");
          await matchMaker.remoteRoomCall(reservedSeat1.roomId, "lock");

          const reservedSeat2 = await matchMaker.joinOrCreate("room3");
          await matchMaker.remoteRoomCall(reservedSeat2.roomId, "lock");

          const reservedSeat3 = await matchMaker.joinOrCreate("room3");
          await matchMaker.remoteRoomCall(reservedSeat3.roomId, "lock");

          let rooms = await matchMaker.query({});
          assert.strictEqual(3, rooms.length);
          assert.strictEqual(true, rooms[0].locked);
          assert.strictEqual(true, rooms[1].locked);
          assert.strictEqual(true, rooms[2].locked);
        });
      });

      it("remote room call should always serialize as JSON", async () => {
        matchMaker.defineRoomType('remoteroomcall', class _ extends Room {
          methodName(arg1, arg2) {
            return [arg1, arg2];
          }
        });

        class CustomClass {
          attr = 1;
        }

        const reservedSeat = await matchMaker.joinOrCreate("remoteroomcall");
        const result = await matchMaker.remoteRoomCall(reservedSeat.roomId, "methodName", [new CustomClass(), new CustomClass()]);

        assert.ok(!(result[0] instanceof CustomClass));
        assert.ok(!(result[1] instanceof CustomClass));

        assert.strictEqual(result[0].attr, 1);
        assert.strictEqual(result[1].attr, 1);
      });

      describe("concurrency", async () => {
        it("should create 50 rooms", async () => {
          const numConnections = 100;

          const promises: any = [];
          for (let i = 0; i < numConnections; i++) {
            promises.push(new Promise<void>(async (resolve, reject) => {
              try {
                const reservedSeat = await matchMaker.joinOrCreate("room2");
                const room = matchMaker.getLocalRoomById(reservedSeat.roomId);
                await createDummyClient(reservedSeat).confirmJoinRoom(room);
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

        it("should join or create concurrently", async () => {
          matchMaker.defineRoomType("concurrent", class extends Room {
            maxClients = 2;
            onCreate(_: { code: string }) {}
          }).filterBy(['code']);

          const codes = ["000", "111", "222"];
          const promises: Promise<any>[] = [];
          for (let i = 0; i < 2; i++) {
            codes.forEach((code) => {
              promises.push(matchMaker.joinOrCreate("concurrent", { code }));
            })
          }
          await Promise.all(promises);

          const rooms = await matchMaker.query({});
          assert.strictEqual(rooms.length, 3);
          assert.deepStrictEqual(rooms.map((r) => r.clients).sort(), [2, 2, 2]);

          // disconnect room
          for (const room of rooms) {
            await matchMaker.getLocalRoomById(room.roomId).disconnect();
          }
        });
      });

      describe("remote room creation", async () => {
        // autoDispose=false: rooms outlive the create request, so a duplicate is observable
        class PersistentRoom extends Room {
          autoDispose = false;
          onCreate() {}
        }

        let recovered: Deferred<void>;      // releases the stalled process
        let drained: Promise<any>;          // resolves once it has answered
        let received: any[];                // the arguments it received

        //
        // Stands in for a process whose event loop is blocked: it answers the
        // create request only once `recovered` is resolved.
        //
        // It is registered with no rooms, so `selectProcessIdToCreateRoom()`
        // prefers it over this process, which owns the "bias" room by then.
        //
        async function selectStalledProcess(processId: string) {
          await matchMaker.handleCreateRoom("bias", {});
          matchMaker.presence.hset('roomcount', processId, "0,0");

          await subscribeIPC(matchMaker.presence, `p:${processId}`, (method: string, args: any) => {
            if (method === 'healthcheck') { return true; }

            received = args;
            return drained = recovered.then(() => matchMaker.handleCreateRoom.apply(undefined, args));
          });
        }

        beforeEach(() => {
          recovered = new Deferred<void>();
          drained = Promise.resolve();
          matchMaker.defineRoomType("bias", PersistentRoom);
          matchMaker.defineRoomType("one", PersistentRoom);
        });

        afterEach(async () => {
          // never leave a pending create behind, it would land in the next test
          recovered.resolve();
          await drained.catch(() => {});
        });

        it("should not create a second room when the remote process answers late", async () => {
          await selectStalledProcess("stalled1");

          const room = await matchMaker.createRoom("one", {});
          assert.strictEqual(matchMaker.processId, room.processId, "must fall back to this process");

          recovered.resolve();
          await drained;

          const roomIds = (await matchMaker.query({ name: "one" })).map((cache) => cache.roomId);
          assert.deepStrictEqual(roomIds, [room.roomId], "one createRoom() call must create one room");
        });

        it("should leave the roomId to the remote process when the driver can't reject duplicates", async () => {
          // an older driver package, without insert() (shadows the prototype method)
          (driver as any).insert = undefined;

          try {
            await selectStalledProcess("stalled2");

            const room = await matchMaker.createRoom("one", {});
            recovered.resolve();
            await drained;

            // nothing can arbitrate, so the duplicate survives — it must just not reuse the roomId
            const roomIds = (await matchMaker.query({ name: "one" })).map((cache) => cache.roomId);
            assert.strictEqual(2, roomIds.length);
            assert.strictEqual(2, new Set(roomIds).size, "rooms must not share a roomId");
            assert.ok(roomIds.includes(room.roomId));

          } finally {
            delete (driver as any).insert;
          }
        });

        //
        // Shutdown can't see a room until it is counted and registered, and two
        // awaits come before that: onCreate() and the cache write. Each test
        // below parks the create in one of them, then shuts down.
        //
        async function assertShutdownReleases(pending: Promise<any>, resume: Deferred<void>) {
          await matchMaker.gracefullyShutdown(); // it can't see the room, so it finishes first
          resume.resolve();
          await assert.rejects(pending);

          assert.strictEqual(0, matchMaker.stats.local.roomCount, "shutdown must not leave a room running");
          assert.strictEqual(0, (await driver.query({})).length, "nor its cache entry");
        }

        it("should not leave a room behind when shutdown starts during onCreate()", async () => {
          const entered = new Deferred<void>();
          const resume = new Deferred<void>();
          matchMaker.defineRoomType("slow_create", class extends Room {
            async onCreate() { entered.resolve(); await resume; }
          });

          let writes = 0;
          const insert = driver.insert!;
          (driver as any).insert = (room: IRoomCache) => { writes++; return insert.call(driver, room); };

          try {
            const pending = matchMaker.handleCreateRoom("slow_create", {});
            await entered;
            await assertShutdownReleases(pending, resume);

            assert.strictEqual(0, writes, "must not record a room while shutting down");

          } finally {
            resume.resolve();
            delete (driver as any).insert;
            await matchMaker.setup(undefined, driver); // afterEach expects a running matchmaker
            await matchMaker.accept();
          }
        });

        it("should not leave a room behind when shutdown starts while recording it", async () => {
          const entered = new Deferred<void>();
          const resume = new Deferred<void>();
          const insert = driver.insert!;
          (driver as any).insert = async (room: IRoomCache) => {
            entered.resolve();
            await resume;
            return insert.call(driver, room);
          };

          try {
            const pending = matchMaker.handleCreateRoom("one", {});
            await entered;
            await assertShutdownReleases(pending, resume);

          } finally {
            resume.resolve();
            delete (driver as any).insert;
            await matchMaker.setup(undefined, driver); // afterEach expects a running matchmaker
            await matchMaker.accept();
          }
        });

        it("should send the roomId where an older process would ignore it", async () => {
          await selectStalledProcess("stalled3");

          recovered.resolve(); // answer right away, this is about the arguments
          await matchMaker.createRoom("one", {});

          // older receivers .apply() these onto handleCreateRoom(name, options, restoringRoomId)
          assert.ok(!received[2], "3rd argument must stay empty");
          assert.strictEqual("string", typeof received[3]);
        });
      });

      describe("cleaning up stale rooms and processId's", async () => {
        async function createDummyRoomCache(data: Partial<IRoomCache>) {
          const cache = initializeRoomCache(data);
          await driver.persist(cache, true);
          return cache;
        }

        it("should clean up stale processId's", async () => {
          //
          // create fake processId and room caches
          //
          const fakeProcessIds = ["dummy1", "dummy2", "dummy3", matchMaker.processId];
          for (const fakeProcessId of fakeProcessIds) {
            matchMaker.presence.hset('roomcount', fakeProcessId, "10,10");

            for (let i = 0; i < 10; i++) {
              await createDummyRoomCache({
                processId: fakeProcessId,
                roomId: generateId(),
                name: "one",
                locked: false,
                clients: 1,
                maxClients: 2,
              });
            }
          }

          const allStats = await matchMaker.stats.fetchAll();
          assert.strictEqual(4, allStats.length);

          assert.strictEqual(40, (await driver.query({})).length);

          const allChecksPromise = matchMaker.healthCheckAllProcesses();

          assert.ok(matchMaker.healthCheckProcessId("dummy1") == matchMaker.healthCheckProcessId("dummy1"), "should return the ongoing promise");
          assert.ok(matchMaker.healthCheckProcessId("dummy2") == matchMaker.healthCheckProcessId("dummy2"), "should return the ongoing promise");
          assert.ok(matchMaker.healthCheckProcessId("dummy3") == matchMaker.healthCheckProcessId("dummy3"), "should return the ongoing promise");

          await allChecksPromise;

          assert.strictEqual(10, (await driver.query({})).length);

        });

        it("auto-heal when trying to reserve seat on stale processId", async () => {
          assert.strictEqual(0, (await driver.query({})).length);

          matchMaker.defineRoomType("one", class extends Room { });
          matchMaker.presence.hset('roomcount', "dummy1", "1,1");
          await createDummyRoomCache({
            processId: "dummy1",
            roomId: 'BadRoomId',
            name: "one",
            locked: false,
            clients: 1,
            maxClients: 4,
          });

          assert.strictEqual(1, (await driver.query({})).length);

          let room!: matchMaker.ISeatReservation;
          await assert.doesNotReject(async () => {
            room = await matchMaker.joinOrCreate("one");
          });

          assert.strictEqual(room.processId, matchMaker.processId);
          assert.strictEqual(1, (await driver.query({})).length);
        });

        it("devMode: auto-heal when trying to reserve seat on stale processId", async () => {
          setDevMode(true);

          try {
            assert.strictEqual(0, (await driver.query({})).length);

            matchMaker.defineRoomType("one", class extends Room { });
            matchMaker.presence.hset('roomcount', "dummy1", "1,1");
            await createDummyRoomCache({
              processId: "dummy1",
              roomId: 'BadRoomId',
              name: "one",
              locked: false,
              clients: 1,
              maxClients: 4,
            });

            assert.strictEqual(1, (await driver.query({})).length);

            let room!: matchMaker.ISeatReservation;
            await assert.doesNotReject(async () => {
              room = await matchMaker.joinOrCreate("one");
            });

            assert.strictEqual(room.processId, matchMaker.processId);

            // stale 'BadRoomId' row must be gone; only the fresh room remains
            const rooms = await driver.query({});
            assert.strictEqual(1, rooms.length);
            assert.notStrictEqual('BadRoomId', rooms[0].roomId);

          } finally {
            setDevMode(false);
          }
        });

      });

    });

  }

});
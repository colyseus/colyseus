import { matchMaker, Room } from "../src";
import { DummyRoom, Room2Clients, createDummyClient, awaitForTimeout } from "./utils/mock";
import assert, { AssertionError } from "assert";

describe("MatchMaker", () => {

  /**
   * register room types
   */
  before(() => {
    matchMaker.defineRoomType("dummy", DummyRoom);
    matchMaker.defineRoomType("room2", Room2Clients);
    matchMaker.defineRoomType("reconnect", Room2Clients);
  });

  /**
   * `setup` matchmaker to re-set graceful shutdown status
   */
  beforeEach(() => matchMaker.setup(undefined, undefined, 'dummyProcessId'));

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

    it("join() should fail if room doesn't exist", async () => {
      assert.rejects(async () => await matchMaker.join("dummy"), /no rooms found/i);
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
      assert.rejects(async () => await matchMaker.joinById(reservedSeat1.room.roomId), /locked/i);
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
    it("should not allow to reconnect", async () => {
      const reservedSeat1 = await matchMaker.joinOrCreate("dummy");

      const client1 = createDummyClient(reservedSeat1);
      const room = matchMaker.getRoomById(reservedSeat1.room.roomId);
      await room._onJoin(client1 as any);

      assert.equal(1, room.clients.length);

      client1.close();
      await awaitForTimeout(50);

      // TODO: try to reconnect and check
    });
  });

});
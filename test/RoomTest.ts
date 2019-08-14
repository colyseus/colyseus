import assert from "assert";
import msgpack from "notepack.io";
import sinon from 'sinon';
import WebSocket from "ws";

import { Room } from "../src/Room";
import { MatchMaker } from './../src/MatchMaker';
import { Protocol } from "../src/Protocol";

import {
  createDummyClient,
  DummyRoom,
  DummyRoomWithState,
  RoomWithAsync,
} from "./utils/mock";
import { generateId } from "../src";

describe('Room', function() {
  let clock: sinon.SinonFakeTimers;
  let tick: any;

  beforeEach(() => {
    clock = sinon.useFakeTimers();
    tick = async (ms) => clock.tick(ms);
  });

  afterEach(() => clock.restore());

  describe('#constructor', function() {

    it('should instantiate with valid options', function() {
      var room = new DummyRoom();
      assert.ok(room instanceof DummyRoom);
    });

  });

  describe('#onJoin/#onLeave', function() {
    it('should receive onJoin messages', function() {
      var room = new DummyRoom();
      var client = createDummyClient();
      var message = null;

      (<any>room)._onJoin(client, {});

      assert.equal(client.messages.length, 1);
      assert.equal((client.messages[0] as Buffer).readUInt8(0), Protocol.JOIN_ROOM);
    });

    it('should receive JOIN_ROOM and ROOM_STATE messages onJoin', function() {
      const room = new DummyRoomWithState();
      const client = createDummyClient();

      (<any>room)._onJoin(client, {});

      assert.equal(client.messages.length, 3);
      assert.equal((client.messages[0] as Buffer).readUInt8(0), Protocol.JOIN_ROOM);
      assert.equal((client.messages[1] as Buffer).readUInt8(0), Protocol.ROOM_STATE);
    });

    it('should close client connection only after onLeave has fulfiled', function(done) {
      clock.restore();

      const room = new RoomWithAsync();
      const client = createDummyClient();

      (<any>room)._onJoin(client);
      (<any>room)._onMessage(client, msgpack.encode([Protocol.LEAVE_ROOM]));

      assert.equal((client.messages[0] as Buffer).readUInt8(0), Protocol.JOIN_ROOM);
      assert.equal(client.readyState, WebSocket.OPEN);

      room.on('disconnect', () => {
        assert.equal(client.readyState, WebSocket.CLOSED);
        done();
      });
    });

    it('should cleanup/dispose when all clients disconnect', function(done) {
      const room = new DummyRoom();
      const client = createDummyClient();

      (<any>room)._onJoin(client);
      assert.ok((<any>room)._patchInterval !== undefined);

      room.on('dispose', function() {;
        assert.ok((<any>room)._patchInterval === undefined);
        done();
      });

      (<any>room)._onLeave(client);
    });
  });

  describe('patch interval', function() {
    it('should set default "patch" interval', function() {
      var room = new DummyRoom();
      assert.equal("object", typeof((<any>room)._patchInterval));
      assert.equal(1000 / 20, room.patchRate, "default patch rate should be 20");
    });

    it('should disable "patch" interval', function() {
      var room = new DummyRoom();

      room.setPatchRate(null);
      assert.equal(undefined, (<any>room)._patchInterval, "patch rate should be disabled");
    });
  });

  describe('#sendState', function() {
    it('should send state when it is set up', function() {
      let room = new DummyRoom();
      let client = createDummyClient();
      (<any>room)._onJoin(client, {});

      room.setState({ success: true });

      // first message
      (<any>room).sendState(client);

      assert.equal((client.messages[1] as Buffer).readUInt8(0), Protocol.ROOM_STATE);
      assert.deepEqual(msgpack.decode(client.messages[2]), { success: true });
    });
  });

  describe('#broadcast', function() {
    it('should broadcast data to all clients', function() {
      let room = new DummyRoom();

      // connect 3 dummy clients into room
      let client1 = createDummyClient();
      (<any>room)._onJoin(client1, {});

      let client2 = createDummyClient();
      (<any>room)._onJoin(client2, {});

      let client3 = createDummyClient();
      (<any>room)._onJoin(client3, {});

      room.broadcast("data");

      assert.equal(Protocol.ROOM_DATA, (client1.messages[1] as Buffer).readUInt8(0));
      assert.equal("data", client1.lastMessage);
      assert.equal("data", client2.lastMessage);
      assert.equal("data", client3.lastMessage);
    });

    it('should broadcast data to all clients, except the provided client', function() {
      let room = new DummyRoom();

      // connect 2 dummy clients into room
      let client1 = createDummyClient();
      (<any>room)._onJoin(client1, {});

      let client2 = createDummyClient();
      (<any>room)._onJoin(client2, {});

      let client3 = createDummyClient();
      (<any>room)._onJoin(client3, {});

      room.broadcast("data", { except: client3 });

      assert.equal(3, client1.messages.length);
      assert.equal(3, client2.messages.length);
      assert.equal(1, client3.messages.length);
      assert.equal("data", client1.lastMessage);
      assert.equal("data", client2.lastMessage);
    });

    it('should broadcast after next patch', function() {
      const room = new DummyRoom();

      // connect 3 dummy clients into room
      const client1 = createDummyClient();
      (<any>room)._onJoin(client1, {});
      const client2 = createDummyClient();
      (<any>room)._onJoin(client2, {});
      const client3 = createDummyClient();
      (<any>room)._onJoin(client3, {});

      room.broadcast("data", { afterNextPatch: true });

      assert.equal(1, client1.messages.length);
      assert.equal(1, client2.messages.length);
      assert.equal(1, client3.messages.length);

      tick(room.patchRate);

      assert.equal(3, client1.messages.length);
      assert.equal(3, client2.messages.length);
      assert.equal(3, client3.messages.length);
      assert.equal("data", client1.lastMessage);
      assert.equal("data", client2.lastMessage);
      assert.equal("data", client3.lastMessage);
    });
  });

  describe('#broadcastPatch', function() {
    it('should fail to broadcast patch without state', function() {
      let room = new DummyRoom();

      // connect 2 dummy clients into room
      let client1 = createDummyClient();
      (<any>room)._onJoin(client1, {});

      let client2 = createDummyClient();
      (<any>room)._onJoin(client2, {});

      assert.equal(undefined, room.state);
      assert.equal(false, (<any>room).broadcastPatch());
    });

    it('should broadcast patch having state', function() {
      let room = new DummyRoom();

      // connect 2 dummy clients into room
      let client1 = createDummyClient();
      (<any>room)._onJoin(client1, {});

      let client2 = createDummyClient();
      (<any>room)._onJoin(client2, {});

      // set state
      room.setState({one: 1});
      assert.deepEqual({one: 1}, room.state);

      // clean state. no patches available!
      assert.equal(false, (<any>room).broadcastPatch());

      // change the state to make patch available
      room.state.one = 111;

      // voila!
      assert.equal(true, (<any>room).broadcastPatch());
    });

    it('shouldn\'t broadcast clean state (no patches)', function() {
      var room = new DummyRoom();
      room.setState({ one: 1 });

      // create 2 dummy connections with the room
      var client = createDummyClient();
      (<any>room)._onJoin(client, {});

      var client2 = createDummyClient();
      (<any>room)._onJoin(client2, {});

      assert.deepEqual({one: 1}, room.state);

      // clean state. no patches available!
      assert.equal(false, (<any>room).broadcastPatch());

      // change the state to make patch available
      room.state.two = 2;
      assert.deepEqual({one: 1, two: 2}, room.state);

      // voila!
      assert.equal(true, (<any>room).broadcastPatch());

      assert.equal(client.messages.length, 5);
      assert.equal(client2.messages.length, 5);

      // first message, join room
      var message = (client.messages[0] as Buffer).readUInt8(0);
      assert.equal(message, Protocol.JOIN_ROOM);

      // second message, room state
      var message = (client.messages[1] as Buffer).readUInt8(0);
      assert.equal(message, Protocol.ROOM_STATE);

      // third message, empty patch state
      var message = (client.messages[3] as Buffer).readUInt8(0);
      assert.equal(message, Protocol.ROOM_STATE_PATCH);
      assert.deepEqual(client.messages[4].length, 22);

      assert.deepEqual(client.messages[4], [ 66, 10, 66, 58, 130, 163, 111, 110, 101, 1, 163, 116, 119, 111, 2, 49, 86, 53, 49, 74, 89, 59 ]);
    });
  });

  describe("#disconnect", () => {

    it("should disconnect all clients", () => {
      let room = new DummyRoom();

      // connect 10 clients
      let lastClient;
      for (var i = 0, len = 10; i < len; i++) {
        lastClient = createDummyClient();
        (<any>room)._onJoin(lastClient, {});
      }

      assert.equal((lastClient.messages[0] as Buffer).readUInt8(0), Protocol.JOIN_ROOM);
      room.disconnect();

      assert.deepEqual(room.clients, []);
    });

    it("should allow asynchronous disconnects", (done) => {
      let room = new DummyRoom();

      // connect 10 clients
      let client1 = createDummyClient();
      (<any>room)._onJoin(client1, {});

      let client2 = createDummyClient();
      (<any>room)._onJoin(client2, {});

      let client3 = createDummyClient();
      (<any>room)._onJoin(client3, {});

      // force asynchronous
      setTimeout(() => (<any>room)._onLeave(client1, true), 1);
      setTimeout(() => {
        assert.doesNotThrow(() => room.disconnect());
      }, 1);
      setTimeout(() => (<any>room)._onLeave(client2, true), 1);
      setTimeout(() => (<any>room)._onLeave(client3, true), 1);

      // fulfil the test
      clock.tick(1);
      done();
    });

  });

  describe("#allowReconnection", () => {
    const matchMaker = new MatchMaker();
    matchMaker.defineRoomType('reconnect', DummyRoom);

    it("should fail waiting same sessionId for reconnection", function (done) {
      // do not use fake timers along with async/await internal functions
      clock.restore();
      this.timeout(2500);

      const client = createDummyClient();
      matchMaker.onJoinRoomRequest(client, 'reconnect', {}).
        then(({ roomId }) => {
          const room = matchMaker.getRoomById(roomId);

          room.onLeave = function (client) {
            this.allowReconnection(client, 2).then(() => {
              assert.fail("this block shouldn't have been reached.");

            }).catch((e) => {
              assert.ok(!matchMaker.getRoomById(roomId), "room should be disposed after failed allowReconnection");

              done();
            })
          }

          matchMaker.connectToRoom(client, roomId).
            then(() => {
              assert.equal(room.clients.length, 1);

              client.emit("close");
              assert.equal(room.clients.length, 0);
            });
        });

    });

    it("should succeed waiting same sessionId for reconnection", async () => {
      const clientId = generateId();
      const firstClient = createDummyClient({ id: clientId });
      const { roomId } = await matchMaker.onJoinRoomRequest(firstClient, 'reconnect', {});

      const room = matchMaker.getRoomById(roomId);
      const reconnectionSpy = sinon.spy();

      room.onLeave = async function(client) {
        try {
          const reconnectionClient = await this.allowReconnection(client, 10);
          assert.equal(client.sessionId, reconnectionClient.sessionId);
          reconnectionSpy();

        } catch (e) {
          assert.fail("catch block shouldn't be called here.");
        }
      }

      await matchMaker.connectToRoom(firstClient, roomId);
      assert.equal(room.clients.length, 1);
      firstClient.emit("close");

      assert.equal(room.clients.length, 0);
      await tick(5 * 1000);

      const secondClient = createDummyClient({ id: clientId });
      const { roomId: secondRoomId } = await matchMaker.onJoinRoomRequest(secondClient, 'reconnect', {
        sessionId: firstClient.sessionId
      });
      assert.equal(roomId, secondRoomId);

      await matchMaker.connectToRoom(secondClient, roomId);
      assert.equal(secondClient.sessionId, firstClient.sessionId);

      // force async functions to be called along with fake timers
      await tick(1);
      await tick(1);
      sinon.assert.calledOnce(reconnectionSpy);
    });

  });

});

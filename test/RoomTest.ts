import * as assert from "assert";
import * as msgpack from "notepack.io";
import * as sinon from 'sinon';
import { Room } from "../src/Room";
import { Protocol } from "../src/Protocol";
import {
  createDummyClient,
  DummyRoom,
  DummyRoomWithTimeline,
  DummyRoomWithState
} from "./utils/mock";

describe('Room', function() {

  describe('#constructor', function() {

    it('should instantiate with valid options', function() {
      var room = new DummyRoom();
      assert.ok(room instanceof DummyRoom);
    });

    it('should instantiate with timeline attribute', function() {
      var room = new DummyRoomWithTimeline();
      assert.equal(0, room.timeline.history.length);
    });

  });

  describe('#onJoin/#onLeave', function() {
    it('should receive onJoin messages', function() {
      var room = new DummyRoom();
      var client = createDummyClient();
      var message = null;

      (<any>room)._onJoin(client, {});

      assert.equal(client.messages.length, 1);

      message = msgpack.decode(client.messages[0]);
      assert.equal(message[0], Protocol.JOIN_ROOM);
    });

    it('should receive JOIN_ROOM and ROOM_STATE messages onJoin', function() {
      var room = new DummyRoomWithState();
      var client = createDummyClient();
      var message = null;

      (<any>room)._onJoin(client, {});

      assert.equal(client.messages.length, 2);

      message = msgpack.decode(client.messages[0]);
      assert.equal(message[0], Protocol.JOIN_ROOM);

      message = msgpack.decode(client.messages[1]);
      assert.equal(message[0], Protocol.ROOM_STATE);
    });

    it('should cleanup/dispose when all clients disconnect', function(done) {
      var room = new DummyRoom();
      var client = createDummyClient();

      (<any>room)._onJoin(client);
      assert.equal(typeof((<any>room)._patchInterval._repeat), "number");

      room.on('dispose', function() {;
        assert.equal(typeof((<any>room)._patchInterval._repeat), "object");
        done();
      });

      (<any>room)._onLeave(client);
    });
  });

  describe('patch interval', function() {
    it('should set default "patch" interval', function() {
      var room = new DummyRoom();
      assert.equal("object", typeof((<any>room)._patchInterval));
      assert.equal(1000 / 20, (<any>room)._patchInterval._idleTimeout, "default patch rate should be 20");
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


      var message = msgpack.decode( client.messages[1] );

      assert.equal(message[0], Protocol.ROOM_STATE);
      assert.deepEqual(msgpack.decode(message[1]), { success: true });
    });
  });

  describe('#broadcast', function() {
    it('should broadcast data to all clients', function() {
      let room = new DummyRoom();

      // connect 2 dummy clients into room
      let client1 = createDummyClient();
      (<any>room)._onJoin(client1, {});

      let client2 = createDummyClient();
      (<any>room)._onJoin(client2, {});

      let client3 = createDummyClient();
      (<any>room)._onJoin(client3, {});

      room.broadcast("data");

      assert.equal("data", client1.lastMessage[1]);
      assert.equal("data", client2.lastMessage[1]);
      assert.equal("data", client3.lastMessage[1]);
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

      assert.equal("data", client1.lastMessage[1]);
      assert.equal("data", client2.lastMessage[1]);
      assert.equal(undefined, client3.lastMessage[1]);
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

      assert.equal(lastClient.lastMessage[0], Protocol.JOIN_ROOM);
      room.disconnect();

      assert.deepEqual(room.clients, {});
    });

    it("should allow asynchronous disconnects", (done) => {
      let room = new DummyRoom();

      let clock = sinon.useFakeTimers();

      // connect 10 clients
      let client1 = createDummyClient();
      (<any>room)._onJoin(client1, {});

      let client2 = createDummyClient();
      (<any>room)._onJoin(client2, {});

      let client3 = createDummyClient();
      (<any>room)._onJoin(client3, {});

      // force asynchronous
      setTimeout(() => (<any>room)._onLeave(client1, true), 0);
      setTimeout(() => {
        assert.doesNotThrow(() => room.disconnect());
      }, 0);
      setTimeout(() => (<any>room)._onLeave(client2, true), 0);
      setTimeout(() => (<any>room)._onLeave(client3, true), 0);

      // fulfil the test
      clock.runAll();
      done();
    });

  });

});


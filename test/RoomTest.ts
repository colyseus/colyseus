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

    it('should disable "patch" interval', function() {
      var room = new DummyRoom();
      
      room.setPatchRate(null);

      assert.equal("object", typeof ((<any>room)._patchInterval));
      assert.equal(-1, (<any>room)._patchInterval._idleTimeout, "patch rate should be disabled; set to -1");
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

      assert.equal(client.messages.length, 3);
      assert.equal(client2.messages.length, 3);

      // first message, join room
      var message = msgpack.decode(client.messages[0]);
      assert.equal(message[0], Protocol.JOIN_ROOM);

      // second message, room state
      var message = msgpack.decode(client.messages[1]);
      assert.equal(message[0], Protocol.ROOM_STATE);

      // third message, empty patch state
      var message = msgpack.decode(client.messages[2]);
      assert.equal(message[0], Protocol.ROOM_STATE_PATCH);
      assert.deepEqual(message[1].length, 22);

      assert.deepEqual(message[1], [ 66, 10, 66, 58, 130, 163, 111, 110, 101, 1, 163, 116, 119, 111, 2, 49, 86, 53, 49, 74, 89, 59 ]);
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

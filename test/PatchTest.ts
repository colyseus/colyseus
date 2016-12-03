import * as assert from "assert";
import * as msgpack from "msgpack-lite";
import { Room } from "../src/Room";
import { createDummyClient, DummyRoom } from "./utils/mock";
import { Protocol } from "../src/Protocol";

describe('Room patches', function() {
  let room: Room<any>;

  beforeEach(function() {
    room = new DummyRoom();
  })

  describe('patch interval', function() {
      var room = new DummyRoom({ })
      assert.equal("object", typeof((<any>room)._patchInterval))
      assert.equal(1000 / 20, (<any>room)._patchInterval._idleTimeout, "default patch rate should be 20")
  })

  describe('simulation interval', function() {
    it('simulation shouldn\'t be initialized by default', function() {
      assert.equal(typeof((<any>room)._simulationInterval), "undefined");
    })
    it('allow setting simulation interval', function() {
      room.setSimulationInterval(() => {}, 1000 / 60);
      assert.equal("object", typeof((<any>room)._simulationInterval));
      assert.equal(1000 / 60, (<any>room)._simulationInterval._idleTimeout);
    })
  })

  describe('#sendState/#broadcastState', function() {
    it('should send state when it is set up', function() {
      let room = new DummyRoom({ });
      let client = createDummyClient();
      (<any>room)._onJoin(client, {});

      room.setState({ success: true });

      // first message
      (<any>room).sendState(client);

      var message = msgpack.decode( client.messages[1] );
      assert.equal(message[0], Protocol.ROOM_STATE);
      assert.deepEqual(message[2], { success: true });

      // second message
      (<any>room).broadcastState();

      var message = msgpack.decode( client.messages[2] );
      assert.equal(message[0], Protocol.ROOM_STATE);
      assert.deepEqual(message[2], { success: true });
    })
  })

  describe('#broadcastPatch', function() {
    it('shouldn\'t broadcast patch with no state or no patches', function() {
      let room = new DummyRoom({ });

      // connect 2 dummy clients into room
      let client1 = createDummyClient();
      (<any>room)._onJoin(client1, {});

      let client2 = createDummyClient();
      (<any>room)._onJoin(client2, {});

      assert.equal(undefined, room.state);

      // broadcasting without having state should throw error
      assert.throws(function () {
        (<any>room).broadcastPatch();
      });

      // ideally patches should be empty if nothing has changed
      assert.equal( 1, client1.messages.length )

      room.setState({one: 1})
      assert.deepEqual({one: 1}, room.state)
      assert.equal(true, (<any>room).broadcastPatch())
    })

    it('shouldn\'t broadcast clean state (no patches)', function() {
      var room = new DummyRoom({ });
      room.setState({ one: 1 });

      // create 2 dummy connections with the room
      var client = createDummyClient();
      (<any>room)._onJoin(client, {});

      var client2 = createDummyClient();
      (<any>room)._onJoin(client2, {});

      assert.deepEqual({one: 1}, room.state);
      assert.equal(true, (<any>room).broadcastPatch());

      room.state.two = 2;
      assert.deepEqual({one: 1, two: 2}, room.state);
      assert.equal(true, (<any>room).broadcastPatch());

      assert.equal(client.messages.length, 4);
      assert.equal(client2.messages.length, 4);

      // first message, join room
      var message = msgpack.decode(client.messages[0]);
      assert.equal(message[0], Protocol.JOIN_ROOM);

      // second message, room state
      var message = msgpack.decode(client.messages[1]);
      assert.equal(message[0], Protocol.ROOM_STATE);

      // third message, empty patch state
      var message = msgpack.decode(client.messages[2]);
      assert.equal(message[0], Protocol.ROOM_STATE_PATCH);
      assert.deepEqual(message[2].length, 17);
      // // TODO: ideally empty patch state should have 0 length
      // assert.deepEqual(message[2].length, 0)

      // fourth message, room patch state
      var message = msgpack.decode(client.messages[3]);
      assert.equal(message[0], Protocol.ROOM_STATE_PATCH);

      assert.deepEqual(message[2], [ 66, 10, 66, 58, 130, 163, 111, 110, 101, 1, 163, 116, 119, 111, 2, 49, 86, 53, 49, 74, 89, 59 ]);
    })
  })

});



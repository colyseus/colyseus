import * as assert from "assert";
import * as msgpack from "notepack.io";
import { Room } from "../src/Room";
import { createDummyClient, DummyRoom, DummyRoomWithState } from "./utils/mock";
import { Protocol } from "../src/Protocol";
import { LocalPresence } from './../src/presence/LocalPresence';

describe('Patch', function() {
  let room: Room<any>;

  beforeEach(function() {
    room = new DummyRoom();
    room.presence = new LocalPresence();
  })

  describe('patch interval', function() {
      let room = new DummyRoomWithState();
      room.setPatchRate(1000 / 20);
      assert.equal("object", typeof((<any>room)._patchInterval));
      assert.equal(1000 / 20, (<any>room)._patchInterval._idleTimeout, "should have patch rate set");
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

  describe('#sendState', function() {
    it('should allow null and undefined values', function() {
      let room = new DummyRoom();
      let client = createDummyClient();

      room.setState({ n: null, u: undefined });
      (<any>room)._onJoin(client, {});

      var message = msgpack.decode( client.messages[1] );
      assert.equal(message[0], Protocol.ROOM_STATE);
      assert.deepEqual(msgpack.decode(message[1]), { n: null, u: undefined });
    })
  })

});

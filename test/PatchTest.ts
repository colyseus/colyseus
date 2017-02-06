import * as assert from "assert";
import * as msgpack from "msgpack-lite";
import { Room } from "../src/Room";
import { createDummyClient, DummyRoom } from "./utils/mock";
import { Protocol } from "../src/Protocol";

describe('Patch', function() {
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

  describe('#sendState', function() {
    xit('should allow null and undefined values', function() {
      let room = new DummyRoom({ });
      let client = createDummyClient();
      (<any>room)._onJoin(client, {});

      room.setState({ n: null, u: undefined });

      var message = msgpack.decode( client.messages[1] );
      assert.equal(message[0], Protocol.ROOM_STATE);
      assert.deepEqual(message[2], { n: null, u: undefined });
    })
  })

});

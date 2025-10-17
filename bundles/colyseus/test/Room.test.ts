import assert from "assert";
import { Room, SchemaSerializer } from "@colyseus/core";
import { Schema } from "@colyseus/schema";
import sinon from "sinon";

describe("Room", () => {
  class State extends Schema { }
  class MyRoom extends Room {
    onCreate() { this.setState(new State()); }
    onMessage() { }
  }

  describe("SchemaSerializer", () => {

    it("setState() should select correct serializer", () => {
      const room = new MyRoom()
      room['__init']();
      room.onCreate();

      assert.ok(room['_serializer'] instanceof SchemaSerializer);
    });

  });


  describe("autoDispose", () => {
    it("should initialize with correct value", () => {
      class MyRoom1 extends Room {
        autoDispose = false;
      }

      const room1 = new MyRoom1();
      room1['__init']();
      assert.strictEqual(false, room1.autoDispose);
      assert.strictEqual(undefined, room1['_autoDisposeTimeout']);

      class MyRoom2 extends Room {
        autoDispose = true;
      }

      const room2 = new MyRoom2();
      room2['__init']();
      assert.strictEqual(true, room2.autoDispose);
      assert.strictEqual(false, room2['_autoDisposeTimeout']['_destroyed']);
    });

    it("autoDispose setter should reset the autoDispose timeout", () => {
      const room = new MyRoom();
      room['__init']();

      // @ts-ignore
      const resetAutoDisposeTimeoutSpy = sinon.spy(room, 'resetAutoDisposeTimeout');

      room.autoDispose = false;
      room.autoDispose = true;

      sinon.assert.callCount(resetAutoDisposeTimeoutSpy, 2);
    });
  });

  describe("patchRate", () => {
    it("should initialize with correct value", () => {
      const room = new MyRoom();
      room['__init']();

      assert.strictEqual(50, room.patchRate);
    });

    //
    // [Bug]: setting patchRate=0 makes clock intervals stop working
    // https://github.com/colyseus/colyseus/issues/869
    //
    xit("TODO: setting patchRate to zero shouldn't interfere with clock's setTimeout", async () => {
      const room = new MyRoom();
      room['__init']();

      let called = 0;
      room.clock.setTimeout(() => called++, 10);

      room.patchRate = 0;

      await new Promise(resolve => setTimeout(resolve, 20));
      assert.strictEqual(1, called);
    });

  });

});

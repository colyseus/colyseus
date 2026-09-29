import assert from "assert";
import { ClientState, Room, SchemaSerializer } from "@colyseus/core";
import { Decoder, Schema, schema, t, type SchemaType } from "@colyseus/schema";
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
    // See: https://github.com/colyseus/colyseus/issues/869
    //
    it("setting patchRate to zero shouldn't interfere with clock's setTimeout", async () => {
      const room = new MyRoom();
      room['__init']();

      let called = 0;
      room.clock.setTimeout(() => called++, 10);

      room.patchRate = 0;

      await new Promise(resolve => setTimeout(resolve, 20));
      assert.strictEqual(1, called);
    });

    it("setting patchRate to zero shouldn't interfere with clock's setInterval", async () => {
      const room = new MyRoom();
      room['__init']();

      let called = 0;
      room.clock.setInterval(() => called++, 10);

      room.patchRate = 0;

      await new Promise(resolve => setTimeout(resolve, 60));
      assert.ok(called >= 3, `Expected at least 3 calls, got ${called}`);
    });

  });

  describe("state and settings as class fields", () => {
    const SyncState = schema({ x: t.number() });
    type SyncState = SchemaType<typeof SyncState>;

    /** Full state + one patch through a fake client, decoded back. */
    function syncedX(room: Room<{ state: SyncState }>, x: number) {
      const frames: Uint8Array[] = [];
      const client: any = { state: ClientState.JOINED, raw: (data: Uint8Array) => frames.push(data.slice()) };
      room.clients.push(client);
      room['sendFullState'](client);
      room.state.x = x;
      room.broadcastPatch();

      const decoded = new SyncState();
      const decoder = new Decoder(decoded);
      for (const frame of frames) { decoder.decode(frame.subarray(1)); }
      return decoded.x;
    }

    function assertSettings(room: Room<{ state: SyncState }>) {
      assert.ok(room['_serializer'] instanceof SchemaSerializer);
      assert.strictEqual(room.maxClients, 4);
      assert.strictEqual(room.patchRate, 20);
      assert.strictEqual(room.autoDispose, false);
      assert.strictEqual(room.unreliablePatchRate, null);
    }

    it("native class fields still sync state to clients", () => {
      class NativeRoom extends Room<{ state: SyncState }> {
        state = new SyncState();
        maxClients = 4;
        patchRate = 20;
        autoDispose = false;
      }

      const room = new NativeRoom();
      // Node's type stripping keeps these as native fields: own properties
      // shadowing Room.prototype's accessors.
      assert.ok(Object.hasOwn(room, "state"), "precondition: native class field");
      room['__init']();

      assertSettings(room);
      assert.strictEqual(syncedX(room, 7), 7);

      const next = new SyncState();
      room.state = next;
      assert.strictEqual(room.state, next);
      assert.strictEqual(syncedX(room, 9), 9);
    });

    it("assigned fields stay on Room.prototype's accessors", () => {
      class AssignedRoom extends Room<{ state: SyncState }> {
        constructor() {
          super();
          this.state = new SyncState();
          this.maxClients = 4;
          this.patchRate = 20;
          this.autoDispose = false;
        }
      }

      const room = new AssignedRoom();
      room['__init']();

      for (const key of ["state", "maxClients", "autoDispose", "patchRate", "unreliablePatchRate"]) {
        assert.ok(!Object.hasOwn(room, key), `'${key}' must not be an own property`);
      }
      assertSettings(room);
      assert.strictEqual(syncedX(room, 7), 7);
    });
  });

});

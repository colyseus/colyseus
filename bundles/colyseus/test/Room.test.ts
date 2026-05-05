import assert from "assert";
import { ClientState, Room, SchemaSerializer } from "@colyseus/core";
import { Decoder, OPERATION, Schema, StateView, $refId, schema, type SchemaType } from "@colyseus/schema";
import sinon from "sinon";

describe("Room", () => {
  class State extends Schema { }
  class MyRoom extends Room {
    onCreate() { this.setState(new State()); }
    onMessage() { }
  }

  describe("SchemaSerializer", () => {
    const FilteredEntity = schema({
      label: "string",
      note: { type: "string", view: true },
    }, "FilteredEntity");

    const PublicNested = schema({
      mode: { type: "string", default: "" },
      tickCount: { type: "uint16", default: 0 },
    }, "PublicNested");

    const FilteredState = schema({
      entities: { map: FilteredEntity, view: true },
      nested: PublicNested,
    }, "FilteredState");

    type FilteredStateInstance = SchemaType<typeof FilteredState>;

    function createFilteredSerializerHarness(state: FilteredStateInstance = new FilteredState()) {
      const serializer = new SchemaSerializer<FilteredStateInstance>();
      const view = new StateView();
      const packets: Uint8Array[] = [];
      const client = {
        id: "client",
        sessionId: "client",
        state: ClientState.JOINED,
        view,
        raw: (packet: Uint8Array) => packets.push(new Uint8Array(packet)),
      };
      const decoder = new Decoder(new FilteredState());

      serializer.reset(state);

      const decode = (packet: Uint8Array) => decoder.decode(packet, { offset: 1 });
      const bootstrap = () => {
        decode(serializer.getFullState(client as any));
        serializer.applyPatches([]);
        packets.length = 0;
      };

      return { serializer, state, view, client, packets, decoder, decode, bootstrap };
    }

    it("setState() should select correct serializer", () => {
      const room = new MyRoom()
      room['__init']();
      room.onCreate();

      assert.ok(room['_serializer'] instanceof SchemaSerializer);
    });

    it("encodes newly visible filtered structures before shared patch changes", () => {
      const { serializer, state, view, client, packets, decoder, decode, bootstrap } = createFilteredSerializerHarness();
      bootstrap();

      const entity = new FilteredEntity({
        label: "new entity",
        note: "view scalar",
      });
      state.entities.set("entity", entity);
      view.add(entity);
      state.nested.mode = "shared change";
      state.nested.tickCount++;

      assert.strictEqual(serializer.applyPatches([client as any]), true);
      assert.strictEqual(packets.length, 1);
      assert.doesNotThrow(() => decode(packets[0]));

      assert.strictEqual(decoder.state.nested.mode, "shared change");
      assert.strictEqual(decoder.state.nested.tickCount, 1);
      assert.strictEqual(decoder.state.entities.get("entity")!.label, "new entity");
      assert.strictEqual(decoder.state.entities.get("entity")!.note, "view scalar");
    });

    it("preserves scalar view fields when structural introductions share the same patch", () => {
      const state = new FilteredState();
      const entity = new FilteredEntity({
        label: "existing entity",
        note: "initial note",
      });
      state.entities.set("entity", entity);

      const { serializer, view, client, packets, decoder, decode, bootstrap } =
        createFilteredSerializerHarness(state);
      bootstrap();

      view.add(entity);
      state.nested.mode = "shared change";

      assert.strictEqual(serializer.applyPatches([client as any]), true);
      assert.strictEqual(packets.length, 1);
      assert.doesNotThrow(() => decode(packets[0]));

      assert.strictEqual(decoder.state.nested.mode, "shared change");
      assert.strictEqual(decoder.state.entities.get("entity")!.label, "existing entity");
      assert.strictEqual(decoder.state.entities.get("entity")!.note, "initial note");
    });

    it("discards stale or invalid view changes without emitting view-only packets", () => {
      const state = new FilteredState();
      const entity = new FilteredEntity({
        label: "visible entity",
        note: "visible note",
      });
      state.entities.set("entity", entity);

      const { serializer, view, client, packets, bootstrap } = createFilteredSerializerHarness(state);
      view.add(entity);
      bootstrap();

      view.changes.set(entity[$refId]!, { 999: OPERATION.ADD });
      view.changes.set(999999, { 0: OPERATION.ADD });

      assert.strictEqual(serializer.applyPatches([client as any]), false);
      assert.strictEqual(packets.length, 0);
      assert.strictEqual(view.changes.size, 0);
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

});

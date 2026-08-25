import assert from "assert";

import { schema, t, Decoder, MapSchema, StateView, type SchemaType } from "@colyseus/schema";
import {
  ClientState,
  Protocol,
  ProtocolModifier,
  Room,
  SchemaSerializer,
  type Client,
} from "@colyseus/core";

//
// `@unreliable` fields never ride a state patch — they go out through
// `applyUnreliablePatches()` over `Client.rawUnreliable`, the transport's
// datagram channel. These tests drive the serializer directly with fake clients
// so the routing, framing and seq are exact and don't depend on a live socket.
//

const State = schema({
  name: t.string(),
  x: t.number().unreliable(),
});
type State = SchemaType<typeof State>;

/** A client that records what each channel received. `rawUnreliable` is only
 *  defined when `unreliableCapable` — its ABSENCE is the capability check the
 *  serializer performs, exactly as a WebSocket transport presents itself. */
function fakeClient(unreliableCapable: boolean, view?: StateView) {
  const reliable: Uint8Array[] = [];
  const unreliableFrames: Uint8Array[] = [];

  const client: any = {
    state: ClientState.JOINED,
    view,
    reliable,
    unreliable: unreliableFrames,
    // copy: the serializer hands out a subarray of its shared buffer, which is
    // overwritten on the next encode.
    raw: (data: Uint8Array) => reliable.push(data.slice()),
  };

  if (unreliableCapable) {
    client.rawUnreliable = (data: Uint8Array) => unreliableFrames.push(data.slice());
  }

  return client as Client & { reliable: Uint8Array[]; unreliable: Uint8Array[] };
}

const seqOf = (frame: Uint8Array) => frame[1] | (frame[2] << 8);

function setup(unreliableCapable = true) {
  const serializer = new SchemaSerializer<State>();
  const state = new State();
  serializer.reset(state);
  const client = fakeClient(unreliableCapable);

  // Drain the initial encode so each test starts from a settled change queue
  // and asserts only on what it mutated itself.
  serializer.applyPatches([client]);
  serializer.applyUnreliablePatches([client]);
  client.reliable.length = 0;
  client.unreliable.length = 0;

  return { serializer, state, client };
}

describe("@unreliable state channel", () => {

  describe("channel routing", () => {
    it("keeps @unreliable fields off the reliable patch, and reliable fields off the datagram", () => {
      const { serializer, state, client } = setup();

      state.name = "Alice";
      state.x = 42;

      assert.strictEqual(serializer.applyPatches([client]), true);
      assert.strictEqual(serializer.applyUnreliablePatches([client]), true);

      assert.strictEqual(client.reliable.length, 1);
      assert.strictEqual(client.unreliable.length, 1);

      // Decoding is covered by @colyseus/schema; assert the ROUTING here — the
      // reliable frame carries the string bytes, the datagram doesn't.
      const asText = (b: Uint8Array) => Buffer.from(b).toString("latin1");
      assert.ok(asText(client.reliable[0]).includes("Alice"), "reliable frame carries `name`");
      assert.ok(!asText(client.unreliable[0]).includes("Alice"), "datagram must not carry `name`");
    });

    it("a tick that only touched @unreliable fields produces no reliable patch at all", () => {
      const { serializer, state, client } = setup();

      state.x = 1;

      assert.strictEqual(serializer.applyPatches([client]), false, "nothing for the reliable channel");
      assert.strictEqual(serializer.applyUnreliablePatches([client]), true);

      assert.strictEqual(client.reliable.length, 0);
      assert.strictEqual(client.unreliable.length, 1);
    });

    it("reports no work when no @unreliable field changed", () => {
      const { serializer, state, client } = setup();

      state.name = "Alice";
      serializer.applyPatches([client]);

      assert.strictEqual(serializer.applyUnreliablePatches([client]), false);
      assert.strictEqual(client.unreliable.length, 0);
    });
  });

  describe("framing", () => {
    it("stamps ROOM_STATE_PATCH | UNRELIABLE and never the TIMED bit", () => {
      const { serializer, state, client } = setup();

      state.x = 7;
      serializer.applyUnreliablePatches([client]);

      // Exact byte: ROOM_STATE_PATCH, UNRELIABLE set, and TIMED necessarily clear
      // — the clock sample and input ack must stay on the ordered channel.
      const frame = client.unreliable[0];
      assert.strictEqual(frame[0], Protocol.ROOM_STATE_PATCH | ProtocolModifier.UNRELIABLE);
    });

    it("increments the seq once per flush, and shares it across recipients", () => {
      const { serializer, state } = setup();
      const a = fakeClient(true);
      const b = fakeClient(true);

      state.x = 1;
      serializer.applyUnreliablePatches([a, b]);
      state.x = 2;
      serializer.applyUnreliablePatches([a, b]);

      const first = seqOf(a.unreliable[0]);
      assert.strictEqual(seqOf(a.unreliable[1]), first + 1, "one bump per flush");
      assert.strictEqual(seqOf(b.unreliable[0]), first, "every recipient of a flush shares its seq");
      assert.strictEqual(seqOf(b.unreliable[1]), first + 1);
    });

    it("wraps the seq at 65536 rather than overflowing the uint16", () => {
      const { serializer, state, client } = setup();

      serializer["unreliableSeq"] = 0xFFFF;
      state.x = 1;
      serializer.applyUnreliablePatches([client]);

      assert.strictEqual(seqOf(client.unreliable[0]), 0);
    });
  });

  describe("transports without a datagram channel", () => {
    it("skips the client entirely, on neither channel", () => {
      const { serializer, state, client } = setup(/* unreliableCapable */ false);

      state.x = 1;

      assert.strictEqual(serializer.applyUnreliablePatches([client]), false);
      assert.strictEqual(client.reliable.length, 0, "must not silently fall back to reliable");
    });

    it("still drains the change queue, so it can't grow without bound", () => {
      const { serializer, state, client } = setup(false);

      for (let i = 0; i < 5; i++) {
        state.x = i;
        serializer.applyUnreliablePatches([client]);
      }

      // Queue drained each time ⇒ a capable client joining later sees only the
      // newest value, never five ticks of backlog.
      const capable = fakeClient(true);
      state.x = 99;
      assert.strictEqual(serializer.applyUnreliablePatches([capable]), true);
      assert.strictEqual(capable.unreliable.length, 1);
    });

    it("sends to the capable clients in a mixed room", () => {
      const { serializer, state } = setup();
      const h3 = fakeClient(true);
      const ws = fakeClient(false);

      state.x = 1;
      assert.strictEqual(serializer.applyUnreliablePatches([h3, ws]), true);

      assert.strictEqual(h3.unreliable.length, 1);
      assert.strictEqual(ws.reliable.length, 0);
    });
  });

  describe("client lifecycle", () => {
    it("skips clients that haven't finished joining", () => {
      const { serializer, state, client } = setup();
      (client as any).state = ClientState.JOINING;

      state.x = 1;
      assert.strictEqual(serializer.applyUnreliablePatches([client]), false);
      assert.strictEqual(client.unreliable.length, 0);
    });

    it("serves a late joiner the current value of an @unreliable field", () => {
      const { serializer, state, client } = setup();

      // Prime the full-state cache, then mutate ONLY over the unreliable
      // channel — `root.changes` stays empty, so a cache that isn't invalidated
      // here would hand the late joiner a stale `x`.
      state.name = "Alice";
      serializer.getFullState(client);

      state.x = 123;
      serializer.applyUnreliablePatches([client]);

      const decoded = new State();
      new Decoder(decoded).decode(serializer.getFullState(fakeClient(true)).subarray(1));
      assert.strictEqual(decoded.x, 123, "full state must reflect unreliable-only mutations");
    });
  });

  describe("per-view filtering", () => {
    const Entity = schema({
      id: t.string(),
      secret: t.number().view().unreliable(),
    });
    type Entity = SchemaType<typeof Entity>;

    const ViewState = schema({
      entities: t.map(Entity).default(new MapSchema<Entity>()),
    });

    it("emits a @view + @unreliable field only to the views that can see it", () => {
      const serializer = new SchemaSerializer<any>();
      const state = new ViewState();
      serializer.reset(state);

      const e = new Entity();
      e.id = "a";
      state.entities.set("a", e);

      const seerView = new StateView();
      const seer = fakeClient(true, seerView);
      const blind = fakeClient(true, new StateView());
      seerView.add(e);

      serializer.applyPatches([seer, blind]);

      e.secret = 99;
      assert.strictEqual(serializer.applyUnreliablePatches([seer, blind]), true);

      // Both get a frame; only the seer's carries a payload past the 3-byte header.
      assert.ok(seer.unreliable[0].byteLength > 3, "view that added the entity receives the field");
      assert.strictEqual(blind.unreliable[0].byteLength, 3, "view without the entity gets header only");
    });
  });

  //
  // The one hazard of splitting state across two channels: an entity's ADD
  // travels the reliable stream while its `@unreliable` fields travel
  // datagrams, so a datagram can name a refId the client hasn't been told
  // about. These pin what actually happens — measured, not assumed.
  //
  describe("cross-channel ordering", () => {
    const Entity = schema({
      name: t.string(),
      x: t.number().default(0).unreliable(),
    });
    type Entity = SchemaType<typeof Entity>;

    const MapState = schema({
      entities: t.map(Entity).default(new MapSchema<Entity>()),
    });

    /** A serializer plus a decoder already synced through a full state sync. */
    function connected() {
      const serializer = new SchemaSerializer<any>();
      const state = new MapState();
      serializer.reset(state);
      const client = fakeClient(true);
      const decoded: any = new MapState();
      const decoder = new Decoder(decoded);
      decoder.decode(serializer.getFullState(client).subarray(1));
      client.reliable.length = 0;
      client.unreliable.length = 0;
      return { serializer, state, client, decoded, decoder };
    }

    const feedReliable = (d: Decoder, c: any) => {
      for (const f of c.reliable) { d.decode(f.subarray(1)); }
      c.reliable.length = 0;
    };
    const feedUnreliable = (d: Decoder, c: any) => {
      // 1 protocol byte + 2 seq bytes
      for (const f of c.unreliable) { d.decode(f.subarray(3)); }
      c.unreliable.length = 0;
    };

    /** Count `"refId" not found` reports without letting them hit the console. */
    function captureRefIdErrors<T>(fn: () => T): { result: T; errors: number } {
      const realError = console.error;
      const realWarn = console.warn;
      let errors = 0;
      console.error = (...args: any[]) => {
        if (String(args[0]).includes("refId")) { errors++; return; }
        realError(...args);
      };
      console.warn = (...args: any[]) => {
        if (String(args[0]).includes("report this issue")) { return; }
        realWarn(...args);
      };
      try {
        return { result: fn(), errors };
      } finally {
        console.error = realError;
        console.warn = realWarn;
      }
    }

    it("steady state never races — no errors once the entity is known", () => {
      const { serializer, state, client, decoded, decoder } = connected();
      const e = new Entity();
      e.name = "frank";
      state.entities.set("f", e);
      serializer.applyPatches([client]);
      feedReliable(decoder, client);

      const { errors } = captureRefIdErrors(() => {
        for (let i = 1; i <= 50; i++) {
          e.x = i;
          serializer.applyUnreliablePatches([client]);
          feedUnreliable(decoder, client);
        }
      });

      assert.strictEqual(errors, 0);
      assert.strictEqual(decoded.entities.get("f").x, 50, "exact, every tick");
    });

    it("a full state sync carries @unreliable values, but a mid-session ADD does not", () => {
      const { serializer, state, client, decoded, decoder } = connected();

      const e = new Entity();
      e.name = "alice";
      e.x = 111;
      state.entities.set("a", e);

      // Reliable patch only — the unreliable channel is never flushed.
      serializer.applyPatches([client]);
      feedReliable(decoder, client);

      const added = decoded.entities.get("a");
      assert.strictEqual(added.name, "alice", "reliable fields ride the ADD");
      assert.strictEqual(added.x, undefined,
        "@unreliable fields do NOT ride the ADD — they arrive only by datagram");

      // A client joining now gets the value, because encodeAll includes it.
      const lateState: any = new MapState();
      const lateDecoder = new Decoder(lateState);
      lateDecoder.decode(serializer.getFullState(fakeClient(true)).subarray(1));
      assert.strictEqual(lateState.entities.get("a").x, 111,
        "full state sync DOES carry it — this asymmetry is what opens the gap");
    });

    it("a datagram that overtakes its entity's ADD is skipped, not applied", () => {
      const { serializer, state, client, decoded, decoder } = connected();

      const e = new Entity();
      e.name = "carol";
      e.x = 333;
      state.entities.set("c", e);

      serializer.applyPatches([client]);
      serializer.applyUnreliablePatches([client]);

      const { errors } = captureRefIdErrors(() => feedUnreliable(decoder, client));
      assert.strictEqual(errors, 1, "one report for the unknown refId");

      feedReliable(decoder, client);
      const got = decoded.entities.get("c");
      assert.strictEqual(got.name, "carol", "the entity itself is intact");
      assert.strictEqual(got.x, undefined, "that tick's value was dropped with the frame");
    });

    it("a faster unreliable cadence costs one report per flush before the ADD ships", () => {
      const { serializer, state, client, decoded, decoder } = connected();

      const e = new Entity();
      e.name = "dave";
      state.entities.set("d", e);

      // patchRate 200 / unreliablePatchRate 20 ⇒ 10 flushes before the ADD.
      const { errors } = captureRefIdErrors(() => {
        for (let i = 1; i <= 10; i++) {
          e.x = i;
          serializer.applyUnreliablePatches([client]);
          feedUnreliable(decoder, client);
        }
      });
      assert.strictEqual(errors, 10, "systematic, not a rare race");

      serializer.applyPatches([client]);
      feedReliable(decoder, client);
      assert.strictEqual(decoded.entities.get("d").x, undefined,
        "the value is still missing once the ADD lands — the ADD doesn't carry it");

      // It self-heals on the next mutation, which for a per-tick field is
      // one unreliable tick later.
      e.x = 999;
      serializer.applyUnreliablePatches([client]);
      feedUnreliable(decoder, client);
      assert.strictEqual(decoded.entities.get("d").x, 999);
    });

    it("a late datagram for a removed entity can't resurrect it", () => {
      const { serializer, state, client, decoded, decoder } = connected();

      const e = new Entity();
      e.name = "erin";
      state.entities.set("e", e);
      serializer.applyPatches([client]);
      feedReliable(decoder, client);

      // Datagram held in flight, then the entity is removed reliably.
      e.x = 55;
      serializer.applyUnreliablePatches([client]);
      const held = client.unreliable.pop()!;

      state.entities.delete("e");
      serializer.applyPatches([client]);
      feedReliable(decoder, client);
      assert.strictEqual(decoded.entities.get("e"), undefined);

      const { errors } = captureRefIdErrors(() => decoder.decode(held.subarray(3)));
      assert.strictEqual(errors, 1);
      assert.strictEqual(decoded.entities.get("e"), undefined, "no resurrection");
      assert.strictEqual(decoded.entities.size, 0, "collection stays consistent");
    });
  });

  describe("Room arming", () => {
    const PlainState = schema({ x: t.number() });

    class UnreliableRoom extends Room {
      onCreate() { this.setState(new State()); }
    }
    class PlainRoom extends Room {
      onCreate() { this.setState(new PlainState()); }
    }

    const rooms: any[] = [];

    /** Boot a room far enough for `__init` to install the accessors and for
     *  `onCreate` to assign state — the point at which arming happens. */
    function boot(RoomClass: any) {
      const room = new RoomClass();
      room["__init"]();
      room.onCreate();
      rooms.push(room);
      return room;
    }

    /** Count flushes without changing what the flush does. */
    function spyFlush(room: any) {
      const serializer = room["_serializer"];
      const original = serializer.applyUnreliablePatches?.bind(serializer);
      const spy = { count: 0 };
      serializer.applyUnreliablePatches = (...args: any[]) => {
        spy.count++;
        return original ? original(...args) : false;
      };
      return spy;
    }

    // Stop every timer these rooms installed, so a later test file doesn't
    // inherit a live patch tick. Order matters: drop the unreliable timer
    // first, or re-arming against a just-disabled patchRate warns.
    afterEach(() => {
      while (rooms.length) {
        const room = rooms.pop();
        room.unreliablePatchRate = null;
        room.patchRate = null;
        clearInterval(room["_simulationInterval"]);
      }
    });

    it("detects @unreliable fields once, at setState()", () => {
      assert.strictEqual(boot(UnreliableRoom)["_serializer"].hasUnreliableFields, true);
      assert.strictEqual(boot(PlainRoom)["_serializer"].hasUnreliableFields, false);
    });

    it("a room without @unreliable state never flushes the channel", async () => {
      const room = boot(PlainRoom);
      const spy = spyFlush(room);

      for (let i = 0; i < 10; i++) {
        room.state.x = i;
        room.broadcastPatch();
      }
      // Also give any timer a chance to fire — there should be none.
      await new Promise((resolve) => setTimeout(resolve, 120));

      assert.strictEqual(spy.count, 0, "the flush must not be wired into the patch tick");
    });

    it("a room with @unreliable state flushes as part of broadcastPatch", () => {
      const room = boot(UnreliableRoom);
      const order: string[] = [];

      const serializer = room["_serializer"];
      const applyPatches = serializer.applyPatches.bind(serializer);
      const applyUnreliable = serializer.applyUnreliablePatches.bind(serializer);
      serializer.applyPatches = (...args: any[]) => { order.push("reliable"); return applyPatches(...args); };
      serializer.applyUnreliablePatches = (...args: any[]) => { order.push("unreliable"); return applyUnreliable(...args); };

      // Synchronous — no interval can interleave. Driving `broadcastPatch()` by
      // hand must flush too: there is one entry point, not a separate tick.
      room.broadcastPatch();

      // Ordering is load-bearing: a spawn's ADD must already be on the reliable
      // wire before the datagram that mutates it.
      assert.deepStrictEqual(order, ["reliable", "unreliable"]);
    });

    it("moves the flush onto its own timer when unreliablePatchRate is set", async () => {
      const room = boot(UnreliableRoom);
      room.patchRate = 1000; // slow enough that it can't be the one flushing
      room.unreliablePatchRate = 16;

      const spy = spyFlush(room);

      room.broadcastPatch();
      assert.strictEqual(spy.count, 0, "the patch tick no longer carries the flush");

      await new Promise((resolve) => setTimeout(resolve, 120));
      assert.ok(spy.count >= 2, `dedicated 16ms timer drives the flush (got ${spy.count})`);
    });
  });

});

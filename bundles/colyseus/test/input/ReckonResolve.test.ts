import assert from "assert";

import { schema, t, MapSchema, type SchemaType } from "@colyseus/schema";
import { Room } from "@colyseus/core";

// -----------------------------------------------------------------------------
// channel.reckonTime zero-sentinel resolution (TODO/26): the userland accessor
// (`room.inputs.get(sid).reckonTime`) resolves an unstamped read to the room
// clock's current elapsedTime — the fallback rooms previously hand-wrote as
// `reckonTime > 0 ? reckonTime : now` — while the rewind binding keeps reading
// the RAW stamp so `_aim`'s midpoint reconstruction still engages for
// unstamped clients.
// -----------------------------------------------------------------------------

const MoveInput = schema({
  x: t.number().default(0),
}, "ReckonResolveInput");

const Entity = schema({
  x: t.number().default(0),
}, "ReckonResolveEntity");
type Entity = SchemaType<typeof Entity>;

class ReckonRoom extends Room {
  inputs = this.defineInput(MoveInput, { bufferMaxSize: 16 });
  rewind = this.allowRewindState({ maxRewindMs: 500 });
}

/** Direct room construction (no transport) + a bare fake client seat. */
function setup() {
  const room = new ReckonRoom();
  const ic = (room as any)._inputController;
  const client: any = {};
  ic.allocate(client);
  ic.register("s1", client);
  return { room, client };
}

describe("Input: accessor reckonTime resolution", () => {
  it("unstamped read resolves to the room clock's elapsedTime (not 0)", () => {
    const { room } = setup();
    room.clock.elapsedTime = 500;
    assert.strictEqual(room.inputs.get("s1").reckonTime, 500);
  });

  it("a consumed reckon-stamped input returns the stamp, ignoring the clock", () => {
    const { room, client } = setup();
    room.clock.elapsedTime = 500;
    client._inputBuffer.push(new MoveInput(), 0, 444);
    room.inputs.get("s1").next();
    assert.strictEqual(room.inputs.get("s1").reckonTime, 444);
  });

  it("unknown session (no-op accessor) still reads 0 — no clock to resolve against", () => {
    const { room } = setup();
    room.clock.elapsedTime = 500;
    assert.strictEqual(room.inputs.get("nope").reckonTime, 0);
  });

  it("rewind keeps the RAW stamp: midpoint reconstruction still engages for unstamped clients", () => {
    // Regression guard for the resolution trap: if bindReckonTime were routed
    // through the RESOLVED accessor getter, _aim would see stamp=elapsedTime>0,
    // take the direct-stamp clamp path, and read at 200 (newest) instead of the
    // midpoint (renderTime 120 + now 200) / 2 = 160.
    const { room, client } = setup();
    const col = new MapSchema<Entity>();
    const e = new Entity();
    col.set("a", e);
    room.rewind.attachAll(col, { fields: ["x"], mode: "reckon" });

    e.x = 0; room.rewind.record(100);
    e.x = 100; room.rewind.record(200);

    client._inputBuffer.push(new MoveInput(), 120, 0); // render-stamped, NO reckon stamp
    room.inputs.get("s1").next();
    room.clock.elapsedTime = 200;

    const seen = room.rewind.lastSeenBy("s1");
    assert.strictEqual(seen.reckonTime, 160, "midpoint (120+200)/2, not the clamp-to-newest 200");
    assert.ok(Math.abs(seen.value(e, "x") - 60) < 1e-6, `x@160 ≈ 60, got ${seen.value(e, "x")}`);
  });
});

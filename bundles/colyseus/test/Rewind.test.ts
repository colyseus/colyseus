import assert from "assert";

import { schema, t, MapSchema, type SchemaType } from "@colyseus/schema";
import { Rewind, RewindView, Room } from "@colyseus/core";

const Entity = schema({
  x: t.number().default(0),
  y: t.number().default(0),
});
type Entity = SchemaType<typeof Entity>;

// A fresh Rewind per test (keyed by a throwaway room object), with one tracked
// entity. Records are driven manually (no simulation loop) so timing is exact.
function setup(maxRewindMs = 200) {
  const room = {};
  const rewind = Rewind.get(room, { maxRewindMs });
  const players = new MapSchema<Entity>();
  const e = new Entity();
  players.set("a", e);
  rewind.attachAll(players, { fields: ["x", "y"] });
  return { rewind, e };
}

describe("Rewind: at() / lastSeenBy", () => {
  it("at() interpolates linearly within the retained window", () => {
    const { rewind, e } = setup();
    e.x = 0; e.y = 0; rewind.record(100);
    e.x = 10; e.y = 20; rewind.record(200);

    const view = rewind.at(150);
    assert.equal(view.time, 150);
    assert.ok(Math.abs(view.value(e, "x") - 5) < 1e-6, `x@150 ≈ 5, got ${view.value(e, "x")}`);
    assert.ok(Math.abs(view.value(e, "y") - 10) < 1e-6, `y@150 ≈ 10, got ${view.value(e, "y")}`);
  });

  it("at(0) is the live fallback (newest sample) — clock not synced", () => {
    const { rewind, e } = setup();
    e.x = 0; rewind.record(100);
    e.x = 10; rewind.record(200);

    const view = rewind.at(0);
    assert.equal(view.time, 200, "clamps to lastRecordedAt");
    assert.equal(view.value(e, "x"), 10, "reads the newest recorded position");
  });

  it("at() clamps a too-old time up to the maxRewindMs window", () => {
    const { rewind, e } = setup(200);
    e.x = 0; rewind.record(100);
    e.x = 10; rewind.record(400); // newest=400 → window starts at 400-200=200

    assert.equal(rewind.at(150).time, 200, "150 < (400-200) → clamped to 200");
    assert.equal(rewind.at(999).time, 400, "future time → clamped to newest");
  });

  it("at() falls back to the live field for an untracked entity (no history)", () => {
    const { rewind } = setup();
    const orphan = new Entity();
    orphan.x = 42;
    assert.equal(rewind.at(100).value(orphan, "x"), 42);
  });

  it("read() batches into an object shaped by the caller's field list", () => {
    const { rewind, e } = setup();
    e.x = 0; e.y = 0; rewind.record(100);
    e.x = 10; e.y = 20; rewind.record(200);

    const pos = rewind.at(150).read(e, ["x", "y"]);
    assert.ok(Math.abs(pos.x - 5) < 1e-6);
    assert.ok(Math.abs(pos.y - 10) < 1e-6);
    assert.deepEqual(Object.keys(pos), ["x", "y"], "shape = exactly the listed fields");

    // Single-field shape — no assumption that x/y/z all exist.
    const onlyY = rewind.at(150).read(e, ["y"]);
    assert.deepEqual(Object.keys(onlyY), ["y"]);
  });

  it("read(out) fills + returns a reused scratch, leaving extra properties untouched", () => {
    const { rewind, e } = setup();
    e.x = 0; e.y = 0; rewind.record(100);
    e.x = 10; e.y = 20; rewind.record(200);

    const scratch = { x: -1, y: -1, alive: true };
    const out = rewind.at(150).read(e, ["x", "y"], scratch);
    assert.equal(out, scratch, "returns the same object");
    assert.ok(Math.abs(scratch.x - 5) < 1e-6);
    assert.ok(Math.abs(scratch.y - 10) < 1e-6);
    assert.equal(scratch.alive, true, "non-listed fields untouched");
  });

  it("at() re-aims the Rewind's internal default view — zero alloc, zero setup", () => {
    const { rewind, e } = setup();
    e.x = 0; rewind.record(100);
    e.x = 10; rewind.record(200);

    const a = rewind.at(100);
    assert.equal(a.value(e, "x"), 0);
    const b = rewind.at(200);
    assert.equal(a, b, "no `out` → the same internal instance, re-aimed");
    assert.equal(b.time, 200);
    assert.equal(b.value(e, "x"), 10);
  });

  it("pass `out` to hold a second, independent view (compare perspectives)", () => {
    const { rewind, e } = setup();
    e.x = 0; rewind.record(100);
    e.x = 10; rewind.record(200);

    const mine = rewind.at(100, new RewindView());
    const def = rewind.at(200);                  // internal default
    assert.notEqual(mine, def);
    assert.equal(mine.time, 100, "unaffected by later default re-aims");
    assert.equal(def.time, 200);
    assert.equal(mine.value(e, "x"), 0);
    assert.equal(def.value(e, "x"), 10);

    rewind.bindRenderTime(() => 100);
    assert.equal(rewind.lastSeenBy("a", mine), mine, "lastSeenBy passes `out` through");
    assert.equal(mine.value(e, "x"), 0);
  });

  it("an un-aimed scratch view fails loudly on read", () => {
    const fresh = new RewindView();
    const e = new Entity();
    assert.throws(() => fresh.value(e, "x"), /not aimed/);
  });

  it("lastSeenBy throws until a render-time resolver is bound", () => {
    const { rewind } = setup();
    assert.throws(() => rewind.lastSeenBy("a"), /renderTime/);
  });

  it("lastSeenBy resolves the bound per-session render time", () => {
    const { rewind, e } = setup();
    e.x = 0; rewind.record(100);
    e.x = 10; rewind.record(200);

    rewind.bindRenderTime((sid) => (sid === "a" ? 150 : 0));
    assert.ok(Math.abs(rewind.lastSeenBy("a").value(e, "x") - 5) < 1e-6);
    // Unknown session → 0 → live fallback (newest).
    assert.equal(rewind.lastSeenBy("zzz").value(e, "x"), 10);
  });
});

// Misconfiguration must FAIL LOUDLY at first use — a silent 0 stamp would read
// live positions and quietly disable lag comp. The resolver is wired by
// Room.allowRewindState through the standard `input` slot, so these construct
// bare rooms (no transport needed for this path).
describe("Rewind: lastSeenBy misconfiguration (Room wiring)", () => {
  it("throws when the room has no input API (never called defineInput)", () => {
    class NoInputRoom extends Room {
      rewind = this.allowRewindState();
    }
    const room = new NoInputRoom();
    assert.throws(() => room.rewind.lastSeenBy("any"), /inputs = this\.defineInput/);
  });

  it("throws when defineInput() lacks renderTime:true", () => {
    class NoStampRoom extends Room {
      inputs = this.defineInput(Entity);   // ← forgot renderTime: true
      rewind = this.allowRewindState();
    }
    const room = new NoStampRoom();
    assert.throws(() => room.rewind.lastSeenBy("any"), /renderTime: true/);
  });

  it("configured room: an unknown/unstamped client is NOT an error (live fallback)", () => {
    class OkRoom extends Room {
      inputs = this.defineInput(Entity, { renderTime: true });
      rewind = this.allowRewindState();
    }
    const room = new OkRoom();
    assert.doesNotThrow(() => room.rewind.lastSeenBy("nobody"));
  });
});

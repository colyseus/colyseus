import assert from "assert";

import { schema, t, type SchemaType } from "@colyseus/schema";
import { InputBufferImpl, type IdleInput } from "@colyseus/core";

const MoveInput = schema({
  moveX: t.int8().default(0),
  jump: t.boolean().default(false),
  yaw: t.float32().default(0),
  dt: t.float32().default(0),
});
type MoveInput = SchemaType<typeof MoveInput>;

function frame(props: Partial<MoveInput>): MoveInput {
  return Object.assign(new MoveInput(), props);
}

// Direct buffer construction (no transport needed): maxSize, seqField, ctor,
// client slice, room-level idle policy. The Room wires the real client (its
// `_input` is the decoder-bound `latest`); tests use a mutable stub.
function setup(opts: { idle?: IdleInput<MoveInput> } = {}) {
  const client = { sessionId: "sid-a", _input: undefined as MoveInput | undefined };
  const buf = new InputBufferImpl<MoveInput>(32, undefined, MoveInput, client, opts.idle);
  return { buf, client };
}

describe("Input: idle synthesis (room-level policy + per-call)", () => {
  it("drain() without any idle policy keeps returning [] on an empty tick", () => {
    const { buf } = setup();
    assert.deepEqual(buf.drain(), []);
    assert.equal(buf.next(), undefined);
  });

  it("room-level policy: bare drain()/next() synthesize automatically", () => {
    const { buf } = setup({ idle: { yaw: 1.5 } });
    const frames = buf.drain();
    assert.equal(frames.length, 1, "declaring `idle` at defineInput IS the opt-in");
    assert.ok(Math.abs(frames[0].yaw - 1.5) < 1e-6);
    assert.equal(frames[0].moveX, 0, "non-overridden fields stay at defaults");
    assert.equal(buf.next()!.moveX, 0, "next() synthesizes too");
  });

  it("per-call { idle } overrides the room-level policy (full replacement)", () => {
    const { buf } = setup({ idle: { yaw: 1 } });
    const [f] = buf.drain({ idle: { yaw: 2 } });
    assert.ok(Math.abs(f.yaw - 2) < 1e-6, "per-call wins");
  });

  it("per-call { idle: false } suppresses the room-level policy", () => {
    const { buf } = setup({ idle: true });
    assert.deepEqual(buf.drain({ idle: false }), []);
    assert.equal(buf.next({ idle: false }), undefined);
  });

  it("idle: true yields pure schema defaults", () => {
    const { buf } = setup({ idle: true });
    const [f] = buf.drain();
    assert.equal(f.moveX, 0);
    assert.equal(f.jump, false);
    assert.equal(f.yaw, 0);
  });

  it("overrides can be a SCHEMA instance (e.g. `latest`) — accessor fields copy", () => {
    const { buf } = setup();
    // Schema fields are prototype accessors (no own props) — the synthesizer
    // must read them by field name, where Object.assign would copy nothing.
    const latest = frame({ moveX: 1, jump: true, yaw: 0.5 });
    const [f] = buf.drain({ idle: latest });
    assert.equal(f.moveX, 1);
    assert.equal(f.jump, true);
    assert.ok(Math.abs(f.yaw - 0.5) < 1e-6);
  });

  it("synthesis is NOT consumption: ack (consumedCount) and renderTime untouched", () => {
    const { buf } = setup({ idle: true });
    buf.push(frame({ moveX: 1 }), 1000);
    buf.drain();
    assert.equal(buf.consumedCount, 1);
    assert.equal(buf.renderTime, 1000);

    buf.drain();        // empty → synthesizes via room policy
    buf.next();
    assert.equal(buf.consumedCount, 1, "idle frames never advance the reconcile ack");
    assert.equal(buf.renderTime, 1000, "renderTime still reflects the last REAL input");
  });

  it("real frames take precedence — idle applies only to empty ticks", () => {
    const { buf } = setup({ idle: { moveX: 1 } });
    buf.push(frame({ moveX: -1 }));
    const frames = buf.drain();
    assert.equal(frames.length, 1);
    assert.equal(frames[0].moveX, -1, "the buffered frame, not the idle one");
    assert.equal(buf.consumedCount, 1);
  });

  it("the idle frame is ONE reused instance, fully refilled per synthesis", () => {
    const { buf } = setup();
    const [a] = buf.drain({ idle: { yaw: 2 } });
    const [b] = buf.drain({ idle: true });
    assert.equal(a, b, "same instance — read within the tick, don't store");
    assert.equal(b.yaw, 0, "stale override from the previous synthesis is reset");
  });

  it("idle callback: invoked LAZILY with ctx { latest, sessionId }, only on empty ticks", () => {
    const { buf, client } = setup();
    client._input = frame({ moveX: 1, jump: true, yaw: 0.25 });

    let calls = 0;
    const idle: IdleInput<MoveInput> = ({ latest, sessionId }) => {
      calls++;
      assert.equal(sessionId, "sid-a", "ctx carries the client's sessionId");
      return { yaw: latest?.yaw ?? 0, dt: 1 / 30 };
    };

    // Buffer has a frame → real frame consumed, callback never runs.
    buf.push(frame({ moveX: -1 }));
    const real = buf.drain({ idle });
    assert.equal(real[0].moveX, -1);
    assert.equal(calls, 0, "callback is lazy — not invoked when frames exist");

    // Empty tick → callback runs once, ctx.latest = the client's bound input.
    const [f] = buf.drain({ idle });
    assert.equal(calls, 1);
    assert.ok(Math.abs(f.yaw - 0.25) < 1e-6, "callback read ctx.latest.yaw");
    assert.equal(f.moveX, 0, "non-overridden fields stay at defaults");
  });

  it("room-level callback returning ctx.latest = hold-everything (held key keeps moving)", () => {
    const { buf, client } = setup({ idle: ({ latest }) => latest ?? true });
    client._input = frame({ moveX: 1, jump: true });
    const f = buf.next()!;
    assert.equal(f.moveX, 1);
    assert.equal(f.jump, true);

    // No latest yet → defaults.
    const { buf: empty } = setup({ idle: ({ latest }) => latest ?? true });
    const g = empty.next()!;
    assert.equal(g.moveX, 0);
    assert.equal(g.jump, false);
  });

  it("no ctor (legacy construction) → idle is a no-op, [] / undefined as before", () => {
    const buf = new InputBufferImpl<MoveInput>(32, undefined);
    assert.deepEqual(buf.drain({ idle: true }), []);
    assert.equal(buf.next({ idle: true }), undefined);
  });

  it("freeze-on-drop: clear() drops pending inputs → idle synthesizes from the next tick, latest preserved", () => {
    // Mirrors the Room's `_onLeave` clear(): a dropped seat must idle immediately,
    // not replay its last-known buffered moves, while ctx.latest stays readable.
    const { buf, client } = setup({ idle: ({ latest }) => ({ yaw: latest?.yaw ?? 0 }) });
    client._input = frame({ moveX: 1, yaw: 0.5 });   // the decoder-bound "latest"

    buf.push(frame({ moveX: 9 }), 1000);              // a couple of unconsumed real inputs
    buf.push(frame({ moveX: 8 }), 1100);
    assert.equal(buf.size, 2);

    buf.clear();                                       // drop (freeze)
    assert.equal(buf.size, 0, "pending real inputs discarded");

    const [f] = buf.drain();
    assert.equal(f.moveX, 0, "no stale real input replayed — pure idle");
    assert.ok(Math.abs(f.yaw - 0.5) < 1e-6, "idle ctx.latest survives clear()");
    assert.equal(buf.next()!.moveX, 0, "keeps synthesizing idle while empty");
  });
});

describe("Input: consume() / iteration", () => {
  it("consume() drains all pending oldest→newest, one at a time (ack += N, size → 0)", () => {
    const { buf } = setup();
    buf.push(frame({ moveX: 1 }));
    buf.push(frame({ moveX: 2 }));
    buf.push(frame({ moveX: 3 }));
    const xs = [...buf.consume()].map((f) => f.moveX);
    assert.deepEqual(xs, [1, 2, 3]);
    assert.equal(buf.size, 0);
    assert.equal(buf.consumedCount, 3, "ack advances once per yielded input");
    assert.equal(buf.wasIdle, false);
  });

  it("for..of (Symbol.iterator) is sugar for consume()", () => {
    const { buf } = setup();
    buf.push(frame({ moveX: 7 }));
    buf.push(frame({ moveX: 8 }));
    const xs: number[] = [];
    for (const f of buf) { xs.push(f.moveX); }
    assert.deepEqual(xs, [7, 8]);
    assert.equal(buf.size, 0);
    assert.equal(buf.consumedCount, 2);
  });

  it("break mid-iteration leaves the remainder buffered (acked only for what was consumed)", () => {
    const { buf } = setup();
    for (let i = 1; i <= 4; i++) { buf.push(frame({ moveX: i })); }
    const seen: number[] = [];
    for (const f of buf) {
      seen.push(f.moveX);
      if (f.moveX === 2) { break; }
    }
    assert.deepEqual(seen, [1, 2]);
    assert.equal(buf.size, 2, "inputs 3 and 4 stay buffered for the next tick");
    assert.equal(buf.consumedCount, 2, "ack reflects only the two consumed");
    // The rest are still consumable on a later pass.
    assert.deepEqual([...buf.consume()].map((f) => f.moveX), [3, 4]);
    assert.equal(buf.consumedCount, 4);
  });

  it("iteration reports per-yielded-input renderTime (not the newest, unlike drain)", () => {
    const { buf } = setup();
    buf.push(frame({ moveX: 1 }), 100);
    buf.push(frame({ moveX: 2 }), 200);
    buf.push(frame({ moveX: 3 }), 300);
    const stamps: number[] = [];
    for (const _f of buf) { stamps.push(buf.renderTime); }
    assert.deepEqual(stamps, [100, 200, 300],
      "renderTime tracks the input currently being applied — the per-step lag-comp fix");
  });

  it("empty + idle policy → exactly one idle frame; ack untouched, wasIdle true", () => {
    const { buf } = setup({ idle: { moveX: 5 } });
    const frames = [...buf.consume()];
    assert.equal(frames.length, 1, "one synthesized idle frame, then stop");
    assert.equal(frames[0].moveX, 5);
    assert.equal(buf.consumedCount, 0, "idle is not consumption");
    assert.equal(buf.wasIdle, true);
  });

  it("empty + no idle policy → zero iterations, wasIdle false", () => {
    const { buf } = setup();
    let count = 0;
    for (const _f of buf) { count++; }
    assert.equal(count, 0);
    assert.equal(buf.wasIdle, false);
  });

  it("real frames present → iterate them, no idle synthesized even with a policy", () => {
    const { buf } = setup({ idle: { moveX: 9 } });
    buf.push(frame({ moveX: 1 }));
    buf.push(frame({ moveX: 2 }));
    const xs = [...buf.consume()].map((f) => f.moveX);
    assert.deepEqual(xs, [1, 2], "idle only fills the empty case");
    assert.equal(buf.wasIdle, false);
  });

  it("per-call consume({ idle }) overrides; { idle: false } suppresses", () => {
    const { buf } = setup({ idle: { moveX: 1 } });
    assert.equal([...buf.consume({ idle: { moveX: 2 } })][0].moveX, 2, "per-call wins");
    assert.deepEqual([...buf.consume({ idle: false })], [], "suppressed → empty iteration");
  });

  it("wasIdle: true after an idle next()/consume(), false after a real input or take()", () => {
    const { buf } = setup({ idle: true });
    buf.push(frame({ moveX: 1 }));
    buf.next();
    assert.equal(buf.wasIdle, false, "real input");
    buf.next();                       // empty → synthesized idle
    assert.equal(buf.wasIdle, true, "synthesized idle");
    buf.take(1);                      // take never synthesizes
    assert.equal(buf.wasIdle, false, "take() resets the flag");
  });
});

describe("Input: read-cursor (no per-item shift)", () => {
  it("peek()/size/at() respect the cursor after a partial consume", () => {
    // seqField buffer so at() is active (the cursor must hide consumed inputs).
    const buf = new InputBufferImpl<MoveInput>(64, "moveX", MoveInput);
    for (let i = 1; i <= 5; i++) { buf.push(frame({ moveX: i })); }
    buf.next(); buf.next();           // consume the two oldest
    assert.equal(buf.size, 3, "two consumed, three remain");
    assert.deepEqual(buf.peek().map((f) => f.moveX), [3, 4, 5], "peek shows only the unconsumed tail");
    assert.equal(buf.at(4)?.moveX, 4, "at() finds a remaining input");
    assert.equal(buf.at(1), undefined, "at() does NOT find a consumed input");
  });

  it("compacts the consumed prefix once the cursor passes the threshold (semantics intact)", () => {
    const buf = new InputBufferImpl<MoveInput>(1000, undefined, MoveInput);
    const N = 40; // > COMPACT_THRESHOLD (32) so an internal splice fires
    for (let i = 0; i < N; i++) { buf.push(frame({ moveX: i })); }
    for (let i = 0; i < 35; i++) { buf.next(); } // crosses the threshold mid-way
    assert.equal(buf.size, 5, "5 remain after consuming 35");
    assert.equal(buf.consumedCount, 35, "ack counts exactly what was consumed");
    assert.deepEqual([...buf.consume()].map((f) => f.moveX), [35, 36, 37, 38, 39],
      "the surviving tail is intact and in order after compaction");
    assert.equal(buf.size, 0);
    assert.equal(buf.consumedCount, 40);
  });

  it("overflow advances the ack via the cursor (oldest dropped, newest kept)", () => {
    const buf = new InputBufferImpl<MoveInput>(3, undefined, MoveInput); // cap 3
    for (let i = 1; i <= 5; i++) { buf.push(frame({ moveX: i })); }       // 1,2 overflow out
    assert.equal(buf.size, 3);
    assert.equal(buf.consumedCount, 2, "two overflowed → counted consumed (ack moves past them)");
    assert.deepEqual([...buf.consume()].map((f) => f.moveX), [3, 4, 5]);
  });

  it("drain() after a partial consume returns only the remaining tail", () => {
    const buf = new InputBufferImpl<MoveInput>(64, undefined, MoveInput);
    for (let i = 1; i <= 5; i++) { buf.push(frame({ moveX: i })); }
    buf.next();                       // consume oldest (cursor → 1)
    const rest = buf.drain();
    assert.deepEqual(rest.map((f) => f.moveX), [2, 3, 4, 5]);
    assert.equal(buf.size, 0);
    assert.equal(buf.consumedCount, 5);
  });
});

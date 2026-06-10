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
});

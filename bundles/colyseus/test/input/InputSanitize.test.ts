import assert from "assert";

import { schema, t, type SchemaType, type Data } from "@colyseus/schema";
import { compileSanitizer, type SanitizeInput } from "@colyseus/core";

const MoveInput = schema({
  moveF: t.int8().default(0),
  pitch: t.float32().default(0),
  dt: t.float32().default(0),
  jump: t.boolean().default(false),
  angle: t.float32().default(0),
});
type MoveInput = SchemaType<typeof MoveInput>;

// `Data<T>` strips the Schema machinery — `Partial<MoveInput>` would map over
// the `this`-polymorphic toJSON/restore and trip TS2615 (circular mapped type).
function frame(props: Partial<Data<MoveInput>>): MoveInput {
  return Object.assign(new MoveInput(), props);
}

const PITCH_LIMIT = 1.5;
const MAX_DT = 0.05;

describe("Input: compileSanitizer (defineInput({ sanitize }))", () => {
  it("map form clamps each listed field into its range", () => {
    const sanitize = compileSanitizer<MoveInput>({
      moveF: [-1, 1],
      pitch: [-PITCH_LIMIT, PITCH_LIMIT],
      dt: [0, MAX_DT],
    });

    const f = frame({ moveF: 127, pitch: -9.7, dt: 3.2 });
    sanitize(f);
    assert.strictEqual(f.moveF, 1, "speed-hack moveF clamped");
    assert.strictEqual(f.pitch, -PITCH_LIMIT);
    assert.ok(Math.abs(f.dt - MAX_DT) < 1e-6, "giant dt clamped to the tick bound");
  });

  it("in-range values pass through identically (honest clients: identity)", () => {
    const sanitize = compileSanitizer<MoveInput>({ moveF: [-1, 1], dt: [0, MAX_DT] });
    const f = frame({ moveF: -1, dt: 0.016 });
    sanitize(f);
    assert.strictEqual(f.moveF, -1);
    assert.ok(Math.abs(f.dt - 0.016) < 1e-6);
  });

  it("NaN lands on the clamp floor — the Math.min(NaN) poisoning hole is closed", () => {
    const sanitize = compileSanitizer<MoveInput>({ dt: [0, MAX_DT], pitch: [-PITCH_LIMIT, PITCH_LIMIT] });
    const f = frame({ dt: NaN, pitch: NaN });
    sanitize(f);
    assert.strictEqual(f.dt, 0, "NaN dt → 0 (no integration)");
    assert.strictEqual(f.pitch, -PITCH_LIMIT, "NaN → min");
    // The hand-rolled forms this replaces both passed NaN through:
    assert.ok(Number.isNaN(Math.max(0, Math.min(NaN, MAX_DT))));
  });

  it("fields not listed in the map are untouched", () => {
    const sanitize = compileSanitizer<MoveInput>({ moveF: [-1, 1] });
    const f = frame({ moveF: 5, pitch: 99, angle: -42, jump: true });
    sanitize(f);
    assert.strictEqual(f.moveF, 1);
    assert.strictEqual(f.pitch, 99, "unlisted numeric field untouched");
    assert.strictEqual(f.angle, -42);
    assert.strictEqual(f.jump, true, "non-numeric fields untouched");
  });

  it("callback form passes through and mutates in place", () => {
    const wrap = (a: number) => ((a + Math.PI) % (2 * Math.PI)) - Math.PI;
    const spec: SanitizeInput<MoveInput> = (f) => {
      f.angle = wrap(f.angle);
      if (f.jump) f.moveF = 0;   // cross-field rule
    };
    const sanitize = compileSanitizer(spec);
    assert.strictEqual(sanitize, spec, "callback is used as-is — no wrapping");

    const f = frame({ angle: 3 * Math.PI, jump: true, moveF: 1 });
    sanitize(f);
    assert.ok(Math.abs(f.angle - wrap(3 * Math.PI)) < 1e-6);
    assert.strictEqual(f.moveF, 0);
  });

  it("works through schema accessors (prototype getters/setters, not own props)", () => {
    const sanitize = compileSanitizer<MoveInput>({ moveF: [-1, 1] });
    const f = new MoveInput();
    f.moveF = -100;
    sanitize(f);
    assert.strictEqual(f.moveF, -1, "read + write went through the generated accessors");
  });
});

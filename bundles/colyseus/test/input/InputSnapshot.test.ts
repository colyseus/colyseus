import assert from "assert";
import { inspect } from "util";

import { $changes, Schema, schema, t, type, type SchemaType } from "@colyseus/schema";
import { compileSnapshot } from "@colyseus/core";

const MoveInput = schema({
  x: t.int8().default(0),
  dt: t.float32().default(0),
  jump: t.boolean().default(false),
  name: t.string().default(""),
  yaw: t.quantized({ min: 0, max: 1, bits: 8 }),

  doubled() { return this.x * 2; },
});
type MoveInput = SchemaType<typeof MoveInput>;

function input(): MoveInput {
  return Object.assign(new MoveInput(), { x: 3, dt: 0.5, jump: true, name: "a", yaw: 0.5 });
}

describe("Input: compileSnapshot (the buffer's copy of a decoded frame)", () => {
  it("a frame reads every field the input held", () => {
    const source = input();
    const frame = compileSnapshot(MoveInput)(source);
    assert.strictEqual(frame.x, 3);
    assert.strictEqual(frame.dt, 0.5);
    assert.strictEqual(frame.jump, true);
    assert.strictEqual(frame.name, "a");
    assert.strictEqual(frame.yaw, source.yaw, "quantized: the snapped value");
  });

  it("a frame doesn't alias the input it came from, in either direction", () => {
    const source = input();
    const frame = compileSnapshot(MoveInput)(source);

    source.x = 9;
    assert.strictEqual(frame.x, 3, "the decoder reuses the input between frames");

    frame.dt = 2;
    assert.strictEqual(frame.dt, 2, "a write lands on the frame");
    assert.strictEqual(source.dt, 0.5);
  });

  it("a frame carries no change tracking", () => {
    assert.strictEqual((compileSnapshot(MoveInput)(input()) as any)[$changes], undefined);
  });

  it("a frame still acts like the schema", () => {
    const frame = compileSnapshot(MoveInput)(input());

    assert.ok(frame instanceof MoveInput);
    assert.strictEqual(frame.constructor, MoveInput);
    assert.strictEqual(frame.doubled(), 6, "methods read the frame's fields");
    assert.deepStrictEqual(Object.keys(frame.toJSON()).sort(), ["dt", "jump", "name", "x", "yaw"]);
    assert.ok(inspect(frame).length > 0, "logging one doesn't throw");

    const clone = frame.clone();
    assert.strictEqual(clone.x, 3);
    assert.ok((clone as any)[$changes] !== undefined, "clone() is a real, tracked schema");
  });

  it("inherited fields come along", () => {
    const Base = schema({ a: t.uint8().default(1) });
    const Child = Base.extend({ b: t.uint8().default(2) });

    const source = new Child();
    source.a = 7;
    source.b = 8;

    const frame = compileSnapshot(Child)(source);
    assert.strictEqual(frame.a, 7);
    assert.strictEqual(frame.b, 8);
  });

  it("reads a class whose fields shadow the schema's accessors", () => {
    // Native class fields (`useDefineForClassFields`) are own properties: the decoder
    // writes those, so the values are on the instance and `$values` stays empty.
    class Shadowed extends Schema {
      constructor() {
        super();
        Object.defineProperty(this, "x", { value: 0, writable: true, enumerable: true, configurable: true });
      }
    }
    type("number")(Shadowed.prototype, "x");

    const source = new Shadowed() as any;
    source.x = 7.5;

    const frame = compileSnapshot(Shadowed)(source) as any;
    assert.strictEqual(frame.x, 7.5);
    assert.strictEqual(frame.toJSON().x, 7.5);

    source.x = 9;
    assert.strictEqual(frame.x, 7.5, "still a copy");
  });

  it("a nested schema or collection gets clone()'s deep copy", () => {
    const Vec = schema({ x: t.uint8().default(0) });
    const Aim = schema({ pos: Vec, list: t.array("number") });

    const source = new Aim();
    source.pos = new Vec();
    source.pos.x = 4;
    source.list.push(1);

    const frame = compileSnapshot(Aim)(source);
    source.pos.x = 5;
    source.list.push(2);

    assert.strictEqual(frame.pos.x, 4);
    assert.strictEqual(frame.list.length, 1);
    assert.ok((frame as any)[$changes] !== undefined);
  });

  it("compiles once per schema, so every room's frames share one shape", () => {
    assert.strictEqual(compileSnapshot(MoveInput), compileSnapshot(MoveInput));
  });
});

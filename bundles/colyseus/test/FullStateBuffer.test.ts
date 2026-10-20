import assert from "assert";

import { schema, t, Encoder, StateView } from "@colyseus/schema";
import { decodeFrames, fakeClient, serializerFor } from "./utils/index.ts";

//
// The full state is encoded once and served to every joiner until the state
// changes. It's encoded into the encoder's shared buffer: patches reuse it,
// and it grows past `Encoder.BUFFER_SIZE` when a state doesn't fit.
//

const Item = schema({ name: t.string() });

/** A state with items enough to overflow the default buffer about twice over. */
function bigState(State: any) {
  const state = new State();
  const name = "x".repeat(100);
  const count = Math.ceil((2 * Encoder.BUFFER_SIZE) / name.length);
  for (let i = 0; i < count; i++) { state.items.push(new Item({ name: `${i}:${name}` })); }
  return state;
}

function viewOf(state: any) {
  const view = new StateView();
  view.add(state);
  return view;
}

/** Run `fn`, counting the encoder's overflow warnings instead of printing them. */
function countOverflowWarnings<T>(fn: () => T): [T, number] {
  const warn = console.warn;
  let count = 0;
  console.warn = (...args: any[]) => {
    if (String(args[0]).includes("buffer overflow")) { count++; } else { warn(...args); }
  };
  try { return [fn(), count]; } finally { console.warn = warn; }
}

describe("Full state encode buffer", () => {

  it("hands joiners the same full state until the state changes", () => {
    const State = schema({ items: t.array(Item) });
    const state = new State();
    state.items.push(new Item({ name: "one" }));
    const serializer = serializerFor(state);
    serializer.applyPatches([]); // until a tick sends them, pending changes force a re-encode

    const cached = serializer.getFullState(fakeClient(false));
    assert.strictEqual(serializer.getFullState(fakeClient(false)), cached);

    state.items.push(new Item({ name: "two" }));
    const frame = serializer.getFullState(fakeClient(false));
    assert.notStrictEqual(frame, cached);
    assert.deepStrictEqual(decodeFrames(State, [frame]), state.toJSON());
  });

  it("encodes the shared part once for joiners with a view until the state changes", () => {
    const State = schema({ items: t.array(Item), secret: t.string().view() });
    const state = new State();
    state.items.push(new Item({ name: "one" }));
    state.secret = "seen by views that add the state";
    const serializer = serializerFor(state);
    serializer.applyPatches([]);

    const encoder = (serializer as any).encoder;
    const encodeAll = encoder.encodeAll;
    let encodes = 0;
    encoder.encodeAll = (...args: any[]) => { encodes++; return encodeAll.apply(encoder, args); };

    serializer.getFullState(fakeClient(false, viewOf(state)));
    const cached = serializer.getFullState(fakeClient(false, viewOf(state)));
    assert.strictEqual(encodes, 1);
    assert.deepStrictEqual(decodeFrames(State, [cached]), state.toJSON());

    state.items.push(new Item({ name: "two" }));
    serializer.getFullState(fakeClient(false, viewOf(state)));
    assert.strictEqual(encodes, 2);
  });

  it("reaches a joiner with a view intact after a view-only patch reused the buffer", () => {
    const State = schema({ items: t.array(Item), secret: t.string().view() });
    const state = new State();
    state.items.push(new Item({ name: "one" }), new Item({ name: "two" }));
    state.secret = "seen by views that add the state";
    const serializer = serializerFor(state);

    const present = fakeClient(false, new StateView());
    serializer.applyPatches([present]);
    serializer.getFullState(fakeClient(false, viewOf(state)));

    present.view!.add(state);
    serializer.applyPatches([present]); // no state change: only a per-view patch

    const frame = serializer.getFullState(fakeClient(false, viewOf(state)));
    assert.deepStrictEqual(decodeFrames(State, [frame]), state.toJSON());
  });

  it("reaches a joiner with a view intact when larger than Encoder.BUFFER_SIZE", () => {
    const State = schema({ items: t.array(Item), secret: t.string().view() });
    const state = bigState(State);
    const serializer = serializerFor(state);

    const [frame] = countOverflowWarnings(() => serializer.getFullState(fakeClient(false, new StateView())));

    assert.deepStrictEqual(decodeFrames(State, [frame]), state.toJSON());
  });

  it("overflows Encoder.BUFFER_SIZE once, not on every join", () => {
    const State = schema({ items: t.array(Item) });
    const state = bigState(State);
    const serializer = serializerFor(state);

    const [frame, warnings] = countOverflowWarnings(() => {
      serializer.getFullState(fakeClient(false));
      state.items.push(new Item({ name: "a change, so the next join re-encodes" }));
      return serializer.getFullState(fakeClient(false));
    });

    assert.strictEqual(warnings, 1);
    assert.deepStrictEqual(decodeFrames(State, [frame]), state.toJSON());
  });

  it("overflows once when only the per-view part is large", () => {
    const State = schema({ items: t.array(Item).view() });
    const state = bigState(State);
    const serializer = serializerFor(state);

    const join = () => serializer.getFullState(fakeClient(false, viewOf(state)));
    const [frame, warnings] = countOverflowWarnings(() => { join(); return join(); });

    assert.strictEqual(warnings, 1);
    assert.deepStrictEqual(decodeFrames(State, [frame]), state.toJSON());
  });

});

# 12 — Input sanitization at `defineInput({ sanitize })`

> Every room re-implements "never trust the wire" by hand-clamping numeric input
> fields per frame. Declare it once at `defineInput` — beside `idle` — and the
> framework sanitizes each decoded frame before anything reads it.

- **Status:** Done (2026-06-10). **Core-only** — no `@colyseus/schema` changes,
  no release sequencing.
- **Priority:** P2
- **Area:** `packages/core` (defineInput + the decode→consume boundary)
- **Surfaced by:** input-consumption DX review across the three reference rooms (2026-06-10)

## Problem / friction

The wire can carry any value of the field's encoding — an `int8` movement axis can
arrive as `127`, a `float32` pitch as garbage. Every sim must clamp before
integrating, and today that's opt-in vigilance repeated per frame in userland:

```ts
// fps-demo FpsRoom (per frame):
moveF: clamp1(f.moveF), moveR: clamp1(f.moveR),
pitch: clampPitch(f.pitch),
dt: Math.max(0, Math.min(f.dt, MAX_DT)),

// test/prediction PlatformerRoom (per frame):
moveX: Math.max(-1, Math.min(1, inp.moveX | 0)) as -1 | 0 | 1,
```

Forgetting is a security bug (an unclamped `moveF: 127` is a speed hack), and the
hand-rolled forms share a **live NaN hole**: `Math.max(0, Math.min(NaN, MAX_DT))`
→ NaN, and `stepPlayer`'s `dt < 0 ? 0 : dt > MAX_DT ? MAX_DT : dt` also passes NaN
— a hacked client sending a NaN float32 `dt` poisons positions into NaN and
broadcasts that to everyone.

## Decided design

```ts
input = this.defineInput(MoveInput, {
  bufferMaxSize: 64,
  renderTime: true,
  // Declarative form — range clamps with framework-owned NaN handling:
  sanitize: {
    moveF: [-1, 1], moveR: [-1, 1],
    pitch: [-PITCH_LIMIT, PITCH_LIMIT],
    dt: [0, MAX_DT],
  },
  idle: ({ latest, sessionId }) => { ... },
});

// …or the callback form for anything beyond ranges:
sanitize: (f) => { f.angle = wrapAngle(f.angle); if (f.crouch) f.jump = false; },
```

- **Shape:** `sanitize?: Partial<Record<NumericFieldsOf<I>, [number, number]>>
  | ((input: I) => void)` — one option, two forms, mirroring `idle`'s
  value-or-callback union.
- **Naming:** `sanitize` — intent-revealing for the untrusted-wire threat model,
  and ecosystem-established as "modifies, never rejects" (express-validator's
  sanitizer/validator split). Rejected: `normalize` (unit-vector collision in
  game-code vocabulary; mechanism- not intent-revealing), `validate` (implies
  rejection), `clamp` (wrong for the callback form), `coerce` (reads as TYPE
  coercion in JS).
- **NaN policy (map form):** the branch clamp `v >= min ? (v <= max ? v : max) : min`
  maps NaN → min for free. `dt NaN → 0` (no integration), `pitch NaN → -LIMIT`.
  Closes the NaN-poisoning hole at zero extra cost.
- **Application point:** core's decode→consume boundary — immediately after the
  `InputDecoder` mutates the bound instance (`client._input`), before the clone
  enters the buffer. `latest`, every buffered frame, and the `idle` callback's
  `ctx.latest` all see normalized values. Idle-synthesized frames skip
  normalization (built server-side from defaults + already-normalized values).
- **Generated setters untouched** — normalization runs per decoded frame
  (~30–120/s/client), never per property assignment. The map form is
  precompiled at `defineInput` into a flat field list (name, min, max); ~4
  accessor reads/writes per frame.

## Explicitly rejected: schema-builder `.clamp()`

An earlier pass decided `t.int8().clamp(-1, 1)` on the field builders
(`schema-5.0/src/types/builder.ts` + a `clampInputs`-gated hook in
`decodeSchemaOperation`). Rejected on reflection: **a builder method that is
inert except when the schema happens to be used as input is confusing API
surface** — schema declares the wire format; `defineInput` declares server
consumption policy (the same layering that placed `idle` and rejected
`.hold()`). The defineInput placement also dissolves two open issues the
builder approach carried: the input-only-vs-all-decoders gating flag (input-only
by construction now) and the `@colyseus/schema` release sequencing (core-only
now). Type-level refinement still composes: `t.int8<-1 | 0 | 1>()` types the
field; `sanitize` enforces it at runtime — builder.ts's own "keep
validating/clamping on the receiving side" note (~line 275) stays true and
finally has a first-class receiving-side tool.

Semantic validation (e.g. "slot must name an owned weapon") stays in userland —
normalization handles value domains, not game rules.

## Implementation notes

- `DefineInputOptions<I>` gains `sanitize`; `_inputOptions` stores a compiled
  `(instance: I) => void` (map → generated clamp loop over a precompiled field
  list; callback → as-is).
- Apply at every site where input bytes mutate `client._input`: the reliable
  `#captureInput` path and the unreliable `decodeAll` path (locate both in
  `Room.ts` during implementation; one helper, called between decode and
  clone/push). Run BEFORE seq-dedupe/push so the buffer never holds raw values
  (the sanitizer must not touch `seqField` — document).
- The shared step functions (`stepPlayer` etc.) keep their internal clamps —
  they serve the CLIENT prediction path, where input never crosses a decoder.
- Tests (`bundles/colyseus/test/input/`): map clamps applied before
  `latest`/buffer visibility; NaN → floor; callback form; idle frames
  unaffected; non-listed fields untouched; works in both reliable and
  unreliable modes.

## Migrations

- **fps-demo:** declare the map; delete the `cmd` literal entirely (`f` flows
  straight into `stepPlayer`), drop `clamp1` + the `clampPitch` import. Optionally
  type `moveF/moveR` as `t.int8<-1 | 0 | 1>()` so `FpsInput`'s literal unions
  hold without casts.
- **platformer:** `sanitize: { moveX: [-1, 1] }`; pass `inp` directly to
  `applyInput`, deleting the per-frame cmd build.
- **2d-shooter:** nothing required (booleans + free-range angle); optionally a
  callback to wrap `angle`.

## Acceptance criteria

- [x] `defineInput({ sanitize })` accepts the map and callback forms (typed
      against the input schema). → `SanitizeInput<I>` + `compileSanitizer`
      (compiled once at defineInput; applied in `#captureInput` before the
      no-buffer early-return, covering both reliable and unreliable paths AND
      latest-only mode).
- [x] Map form clamps with NaN → min; applied before any read (`latest`,
      buffer, idle ctx). → 6 unit tests (`InputSanitize.test.ts`) + an e2e over
      a real SDK connection (`Input.test.ts`: x=127 → latest/drain read 1).
- [x] The three reference rooms drop their hand-rolled clamps — `clamp1`, the
      `clampPitch` import, and the dt/moveX min-max are gone from the consume
      loops; the fps `cmd` literal is deleted (`f` flows straight into
      `stepPlayer`; `moveF/moveR` typed `t.int8<-1|0|1>()`).
- [x] PREDICTION.md documents `sanitize` beside `idle` (the two halves of "what
      enters the sim loop": what values mean + what silence means).

# 12 — Input domain clamps (schema-declared validation)

> Every room re-implements "never trust the wire" by hand-clamping numeric input
> fields per frame. Declare the domain once on the schema and clamp at decode.

- **Status:** Not started
- **Priority:** P2
- **Area:** `@colyseus/schema` (`t` builders) + `packages/core` (input decode path)
- **Surfaced by:** input-consumption DX review across the three reference rooms (2026-06-10)

## Problem / friction

The wire can carry any value of the field's encoding — an `int8` movement axis can
arrive as `127`, a `float32` pitch as `NaN`-adjacent garbage. Every sim must clamp
before integrating, and today that's opt-in vigilance repeated per frame in userland:

```ts
// fps-demo FpsRoom (per frame):
moveF: clamp1(f.moveF), moveR: clamp1(f.moveR),
pitch: clampPitch(f.pitch),
dt: Math.max(0, Math.min(f.dt, MAX_DT)),

// test/prediction PlatformerRoom (per frame):
moveX: Math.max(-1, Math.min(1, inp.moveX | 0)) as -1 | 0 | 1,
```

Forgetting is a security bug, not a style issue (an unclamped `moveF: 127` is a
speed hack). The 2d-shooter forgot for `angle` — harmless there, but the pattern
doesn't scale on vigilance. Notably, **every observed normalization is a pure range
clamp** — a declarative `[min, max]` covers 100% of real usage.

## Proposal

Declare the domain on the schema field builders (decided over `defineInput`-level
options — per-field colocation reads best):

```ts
export const MoveInput = schema({
  moveF: t.int8().clamp(-1, 1),
  moveR: t.int8().clamp(-1, 1),
  pitch: t.float32().clamp(-PITCH_LIMIT, PITCH_LIMIT),
  dt: t.float32().clamp(0, MAX_DT),
  ...
});
```

- `.clamp(min, max)` (and possibly one-sided `.min()` / `.max()`) on the numeric
  `t` builders, alongside the existing `.default()` / `.noSync()` chain.
- **Clamp, don't reject**: a whole-frame reject drops legitimate input on float
  fuzz; clamping is identity for honest clients (no prediction divergence — a
  cheater only desyncs himself) and neutralizes dishonest values.
- **Applied at the server input decode/push path** (`InputBuffer.push` or the
  InputDecoder), so every read — `latest`, `drain`, `next`, `peek`, `at` — sees
  trusted values. Optionally also clamp client-side on encode for symmetry.
- Semantic validation (e.g. "slot must name an owned weapon") stays in userland —
  range clamps handle numeric domains only.

## Explicitly rejected: `.hold()` on the schema

An earlier sketch paired clamps with a per-field `.hold()` marker (carry the last
value into synthesized idle frames). Rejected: "hold" is not a property of the
data — it just means reading `input(sid).latest`, which the InputAPI already
exposes. Absence policy shipped separately as `drain/next({ idle })` (the
`idle: (latest) => overrides` callback), keeping the schema purely about the wire.

## Implementation notes

- The clamp metadata lives in `@colyseus/schema` (builder chain → field metadata);
  core's input layer reads it where decoded frames enter the buffer.
- `@colyseus/schema` is a separate package from this repo — sequence its release
  ahead of the core change that consumes the metadata.

## Acceptance criteria

- [ ] `t.<numeric>().clamp(min, max)` declares a field domain; server decode clamps.
- [ ] The three reference rooms drop their hand-rolled clamps (`clamp1`,
      `clampPitch`, dt/moveX min-max) — grep shows none left in the consume loops.
- [ ] PREDICTION.md documents the clamp-don't-reject rationale + prediction parity.

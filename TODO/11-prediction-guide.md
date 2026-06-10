# 11 — Canonical prediction guide / docs

> The prediction contract (what `lastProcessed` means, why `delta:false` is mandatory, how
> `renderTime`/`room.clock` work, the determinism rules) currently lives only in source and a
> reference project. Write one authoritative guide.

- **Status:** Done (2026-06-09)
- **Priority:** P1 (land alongside brief 01)
- **Area:** docs
- **Surfaced by:** having to read SDK/core source to learn the contract (2026-06-02)

## Resolution

Wrote the canonical guide at `colyseus-0.18/PREDICTION.md` (top-level, alongside
`SCHEMA.md`/`SESSION.md`): mental model → server → client → the contract/rules
(called out as warnings) → determinism → recipes (hand-rolled + physics + remote
smoothing + projectile + lag-comp via `lastSeenBy`) → troubleshooting + an API quick
reference. References all three runnable examples (platformer, 2d-shooter, fps-demo)
and documents the new ergonomics (SDK-computed renderTime, `rewind.lastSeenBy`).

## Problem / friction

To migrate the shooter I learned the prediction contract by **reading the source** — `Room.ts`
(SDK + core), `InputBuffer.ts`, `Rewind.ts`, `RoomClock.ts`, `InputHandle.ts` — and by studying
the reference harness. The non-obvious rules that are load-bearing and undocumented (or buried):

- `input.lastProcessed === ` the server's `consumedCount` (advances when the server `drain()`s /
  `clear()`s / overflows), echoed via the TIMED protocol prefix. Reconcile triggers when it
  advances. (Discovered by reading `InputBuffer.ts`.)
- **`delta:false` is mandatory for prediction**: the reconciler predicts one input per fixed step
  and replays *sent* inputs; `delta:true` drops unchanged inputs → the predicted set ≠ the
  server-applied set → backward drift. (In a doc comment, but easy to miss; it's a footgun.)
- The **input rate is welded to the fixed-step rate** which is welded to the server tick — change
  one, change all (see brief 07).
- **Inputs must be flat primitives** (see brief 08) — runtime-only knowledge today.
- `room.clock` (`serverNow()`, `smoothedRtt()`, `lastServerTime()`) is auto-populated **only when
  the room called `defineInput()`** (the TIMED prefix rides input acks). Great, but undocumented
  enough that you don't know to rely on it.
- Lag-comp semantics: rewind targets to the *acting client's* `renderTime`, not server-now
  (brief 09) — easy to get backwards.
- **Determinism is entirely the user's job** and the failure mode is silent (brief 10): same
  fixed `dt` both sides, a single shared `step`/`applyInput`, matching engine versions.

There's no single page that puts the server half (`defineInput` + `setFixedTimestep` +
`allowRewindState`) next to the client half (`room.input` + the `Predict`/`controller`) with the
rules and gotchas in one place.

## Current state

- API doc comments are good but scattered across packages; the only end-to-end example is the
  `test/prediction` harness.
- The shooter's `demos/multiplayer-2d-shooter-prototype/PREDICTION.md` is effectively a worked
  case study (server + client + shared determinism + lag-comp + bullet prediction) and can seed
  large parts of the official guide.

## Proposal

Write a canonical **"Client-side prediction & reconciliation"** guide covering, in order:

1. **Mental model**: authoritative server sim at a fixed tick; client predicts locally and
   reconciles to server truth; one input per step per tick.
2. **Server**: `defineInput(Input, {renderTime, bufferMaxSize})`, `setFixedTimestep(step, hz)`,
   consuming inputs (`drain` per-entity vs single-consume for shared worlds — brief 03),
   `allowRewindState` for lag comp.
3. **Client**: `room.input({mode:"reliable", delta:false})`, the reconciler/`controller`
   (`fields` + `step`, or opaque-state for physics — brief 02), reading `value()`, the single
   `predict.tick(now)` driver; remote smoothing via `attachAll` modes.
4. **The contract / rules** (call these out as warnings): `lastProcessed`=consumedCount;
   `delta:false` required; flat inputs; input==step==tick coupling; `room.clock` requires
   `defineInput`.
5. **Determinism**: shared `step` (single source of truth), identical fixed `dt`, engine version
   parity; how to tell divergence from jitter (brief 10).
6. **Recipes**: hand-rolled sim (reference platformer) **and** physics-engine sim (the shooter,
   Rapier); remote entity smoothing; projectile/bullet prediction (brief 06); lag-compensated
   hits (brief 09).
7. **Troubleshooting**: "it rubber-bands" / "remotes stutter" / "my bullet overshoots the target"
   (the swept-test tunneling lesson) / "server won't boot under CJS" (brief 04).

## Implementation notes

- Land the core of it **with brief 01** (shipping the lib), so the guide references real
  `@colyseus/sdk` imports, not copied files.
- Reuse `demos/.../PREDICTION.md` as source material — it already documents the shooter end to
  end including the 30 Hz rate, server-time bullets, catch-up, and swept hit-testing.
- Keep two runnable references linked: the hand-rolled platformer (`test/prediction`) and the
  physics-engine shooter (`demos/multiplayer-2d-shooter-prototype`).

## Risks & open questions

- The guide must track API decisions from briefs 01/02/03/06/07/08; sequence it after those land
  (or write it in lockstep) so it doesn't document a shape that's about to change.

## Acceptance criteria

- [x] One published guide covering server + client + contract + determinism + recipes +
      troubleshooting, with copy-runnable examples against shipped `@colyseus/sdk` APIs. → `PREDICTION.md`.
- [x] Each load-bearing rule (lastProcessed, delta:false, flat inputs, rate coupling, clock
      requires defineInput, lag-comp direction) is called out explicitly as a warning/note. → §4.
- [x] Links to both reference implementations. → platformer, 2d-shooter, + fps-demo.

## References

- `packages/sdk/src/{Room.ts, RoomClock.ts, input/InputHandle.ts}`
- `packages/core/src/{Room.ts, input/InputBuffer.ts, Rewind.ts}`
- `test/prediction/` (hand-rolled reference, incl. its own `PLANS`/`PENDING.md`)
- `demos/multiplayer-2d-shooter-prototype/PREDICTION.md` (worked physics-engine case study — seed material)

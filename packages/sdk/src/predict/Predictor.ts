/**
 * Predict — drop-in prediction layer for Colyseus 0.18+ clients.
 *
 * Combines two prediction strategies behind a single ergonomic class:
 *   - Field smoothing (lerp / extrapolate / damped)
 *   - Dead-reckoning (forward-simulate via a shared step function)
 *
 * THE PREDICTION FAMILY — pick by what you're predicting:
 *   - `Predict` (this class) — PASSIVE smoothing of the server stream for
 *     entities you DON'T control (remote players → lerp, AI → reckon). Read
 *     with `predict.value(instance, field)`.
 *   - `predict.reconciler(self, …)` → a {@link Reconciler} — ACTIVE server-
 *     reconciled rollback for the entity you DO control: apply input now,
 *     rewind to server truth + replay, smoothly correcting. Read state for
 *     logic via `controller.state` (exact, mutable).
 *   - `predict.sim(…)` → a {@link SimReconciler} — the same rollback over a
 *     COMPOSITE or engine-backed world. Decoded schema instances placed in
 *     its `world` are AUTO-BOUND (seeding/adopt/pose derive from the schema).
 *   - `predict.defineEvent(…)` → a {@link PredictedEventChannel} — a typed
 *     optimistic DISCRETE event (a goal, a kill, a pickup): predicted from the
 *     sim via `ctx.predict(channel, payload)` (replay-safe) or from UI, with
 *     confirm / rejectWhen / TTL settlement against server truth.
 *     (`predict.events(…)` is its low-level string-keyed store.)
 *
 * ONE READ IDIOM for rendering: `predict.value(instance, field)` covers every
 * entity — passively-smoothed remotes AND the instances a reconciler/sim
 * binds (the controllers register their bound fields here, overlaying any
 * passive slot while they live and restoring it on dispose). Consumers get
 * the full lifecycle for free: raw state before the controller spawns →
 * reconciled pose while it's alive → raw again after `dispose()`. Game logic
 * (hit-reg, zone checks) keeps reading EXACT state via `controller.state` /
 * `controller.world` — never the smoothed render read.
 * One `predict.tick(now)` per frame drives all three — controllers and event
 * stores spawned here are ticked/pruned automatically (see {@link tick}).
 *
 * Mirrors `Callbacks.get(room)` from `@colyseus/schema` — construct via the
 * static factory and attach prediction to schemas as they appear. The
 * server's `room.clock` (delivered via the TIMED protocol prefix when the
 * room called `defineInput()`) is consumed automatically — RTT / server
 * time arrive without any setup.
 *
 *     import { Client } from "colyseus.js";
 *     import { Predict } from "./Predictor";
 *
 *     const room = await client.joinOrCreate("arena");
 *     const predict = Predict.get(room, { mode: "lerp", delay: 80 });
 *
 *     // Smoothing on a single schema instance:
 *     predict.attach(room.state.boss, { x: "lerp", y: "lerp" });
 *
 *     // Dead-reckoning on every child of a collection. Pass the parent
 *     // (e.g. `room.state`) only for nested collections — root-level
 *     // collections take just the key:
 *     predict.attachAll("enemies", {
 *         mode: "reckon", step: stepEnemy, fields: ["x","y","vx"], smoothing: 25,
 *     });
 *
 *     // Once per render frame:
 *     function renderLoop(t: number) {
 *         predict.tick(t);
 *         drawPlayer(predict.value(room.state.boss, "x"), predict.value(room.state.boss, "y"));
 *         requestAnimationFrame(renderLoop);
 *     }
 *
 * For side-by-side mode comparison, spin up multiple Predicts:
 *
 *     const lerp   = Predict.get(room, { mode: "lerp",   delay: 80 });
 *     const damped = Predict.get(room, { mode: "damped", damping: 15 });
 *
 * Low-level primitives `track`, `untrack`, `trackStepped` are also exposed
 * for cases where the declarative `attach(...)` shape doesn't fit.
 *
 * NOTE: call `attach`/`track` AFTER the instance has been delivered by the
 * server (e.g. inside `onAdd`). Attaching to an instance that hasn't been
 * decoded yet throws `Can't addCallback (refId is undefined)`.
 */

import { Callbacks, MapSchema, ArraySchema, SetSchema, type Data } from "@colyseus/schema";
import { PredictedEvents, type PredictedEventsGetOptions } from "./predictedEvents.ts";
import { PredictedEventChannel, type PredictedEventChannelOptions } from "./predictedEventChannel.ts";
import { PredictedSpawns, type PredictedSpawnsOptions } from "./predictedSpawns.ts";
import { Reconciler, type ReconcilerOptions } from "./reconciler.ts";
import { SimReconciler, type SimReconcilerOptions } from "./simReconciler.ts";
import { InputHandleImpl, type InputHandle } from "../input/InputHandle.ts";
import { classifyDrift, type Drift, type DriftStatus } from "./drift.ts";
import { NULL_CLOCK, type RoomClockLike } from "../RoomClock.ts";
import { publishDebug } from "../debug-channel.ts";
import {
    $VALUES,
    refIdOf, metadataOf, fieldIndexOf, scalarFieldNamesOf, makeUnrolledSnapshot,
} from "./schema.ts";

// -----------------------------------------------------------------------------
// Type helpers for narrow inference on Predict.{attach,attachAll,value}.
// -----------------------------------------------------------------------------

/** Keys of T whose value type is `number`. We only smooth numeric fields. */
type NumericKeys<T> = {
    [K in keyof T]-?: T[K] extends number ? K : never;
}[keyof T] & string;

/** Keys of T whose value is a Colyseus collection (Map/Array/Set schema). */
type CollectionKeys<T> = {
    [K in keyof T]-?: T[K] extends MapSchema<any> | ArraySchema<any> | SetSchema<any> ? K : never;
}[keyof T] & string;

/** Element type of a Colyseus collection. */
type ChildOf<C> =
    C extends MapSchema<infer V> ? V :
    C extends ArraySchema<infer V> ? V :
    C extends SetSchema<infer V> ? V :
    never;

export type PredictMode = "lerp" | "extrapolate" | "damped" | "reckon" | "raw";

/**
 * Field-level smoothing options for `lerp` / `extrapolate` / `damped`.
 *
 * `lerp`        — canonical entity interpolation. Buffers recent snapshots
 *                 and renders at `renderTime - delay`, interpolating between
 *                 the bracketing pair. Smooth, lagged, sample-faithful.
 *                 The primary knob is `delay`; size it so jitter rarely
 *                 makes the buffer underrun (1–2 server tick intervals).
 * `extrapolate` — linear forecast from the two most recent samples.
 *                 Live, can overshoot.
 * `damped`      — exponential smoothing toward the latest value.
 *                 Never exact, never jittery.
 */
export interface SmoothingOptions {
    mode?: "lerp" | "extrapolate" | "damped";
    /** Render-time lag in ms for `lerp` (default 100). Ignored by other modes. */
    delay?: number;
    /**
     * Output-smoothing rate (spring constant, default 15 — ~65 ms half-life).
     * Used by `damped` directly and by `extrapolate`'s predict-then-smooth
     * EMA. Ignored by `lerp`. Set to 0 on `extrapolate` to disable smoothing
     * and return the raw forward-projection.
     */
    damping?: number;
    /** Maximum extrapolation overshoot in ms past the latest sample for `extrapolate` (default 200). Ignored by other modes. */
    maxExtrapolate?: number;
    /**
     * Snap incoming sample arrival times to a regular grid of this many ms,
     * relative to the previous sample. 0 disables (default).
     *
     * Useful when the server emits state at a known fixed cadence (e.g.
     * 33.33 ms for a 30 Hz `setSimulationInterval`) and you want lerp /
     * extrapolate to render at a uniform playback velocity regardless of
     * network arrival jitter. Each new sample is timestamped at
     * `lastT + round(elapsed / tickInterval) * tickInterval`, bounded
     * to never overshoot wall-clock `now` by more than one interval.
     *
     * Has no effect on `damped` (which is keyed to render frames, not
     * sample arrivals).
     */
    tickInterval?: number;
    /**
     * Value-space discontinuity threshold. When a new sample's value differs
     * from the previous one by MORE than this, the change is treated as a
     * TELEPORT (respawn, blink, warp) instead of motion: the smoothing state
     * resets to the new value and every mode renders it immediately — no
     * glide across the gap. 0 disables (default).
     *
     * Deliberately time-free: latency/jitter shift when samples arrive, not
     * what they carry, so bursty delivery can't false-trigger it. Size it
     * well above `maxSpeed × patchInterval` (per-sample motion) and below the
     * smallest legitimate teleport. Note the server encodes only the LATEST
     * value per patch — a long server stall coalesces real movement into one
     * sample, so leave headroom for the stalls you'd rather glide through.
     * For `angle` fields the delta is measured after the shortest-arc fold
     * (≤ π), so thresholds above π never trip.
     */
    snap?: number;
    /**
     * Treat the field as an ANGLE in radians. Samples are stored unwrapped
     * (continuous) — each new value is folded onto the previous over the
     * SHORTEST arc — so `lerp` / `damped` / `extrapolate` interpolate correctly
     * across the ±π seam instead of spinning the long way round. Applies to every
     * field in the attach config, so attach angular fields (yaw, pitch) in a
     * SEPARATE call from linear ones (x, y, z). Default false.
     */
    angle?: boolean;
}

/**
 * Entity-level dead-reckoning options. The `step` function advances a scratch
 * copy of the entity forward by `forwardMs` (drawn from the Predict's clock)
 * in fixed substeps; the result is predict-then-smoothed.
 *
 * For Predict constructor defaults `step` is required. For per-`attach` /
 * `attachAll` overrides `step` is optional — if omitted it falls back to the
 * Predict's constructor-time default. Missing on both ⇒ throw with a clear
 * pointer at the call site.
 */
export interface ReckonOptions<T = any> {
    mode: "reckon";
    /** The pure step function. Mutates the provided scratch object in place. */
    step?: (state: T, dt: number, elapsedMs: number) => void;
    /** Predict-then-smooth damping. Default 20 (~50 ms half-life). 0 = snap. */
    smoothing?: number;
    /** Substep length in ms. Smaller = more accurate bounces / collisions. Default 16. */
    substep?: number;
    /** Rebase discontinuities larger than this pop instead of decaying out —
     *  see {@link SmoothingOptions.snap}. 0 disables (default). */
    snap?: number;
}

/**
 * "Off" mode — `value()` returns the latest schema field as-is, with no
 * smoothing or prediction. Useful as a baseline in the SDK debug panel so
 * the visual difference each mode contributes can be A/B-compared against
 * the raw server stream.
 */
export type RawOptions = { mode: "raw" };

/**
 * Discriminated union of mode-specific options. The `mode` field discriminates
 * — TS catches mistakes like `{ mode: "lerp", step: fn }` at compile time.
 */
export type PredictOptions<T = any> = SmoothingOptions | ReckonOptions<T> | RawOptions;

// -----------------------------------------------------------------------------
// SoA slot storage — a single Float64Array holds every tracked slot's runtime
// state, including lerp's snapshot ring. Indexed by slot id (assigned at
// track-time, recycled via a free-list).
//
// Config (mode/delay/damping/maxExtrapolate/tickInterval) is *not* stored
// per slot — it lives in a separate `profileBuf` and the slot only carries a
// `profileIdx`. Many slots that share the same config share one profile, so
// homogeneous attachAll groups collapse to a single 5-float record. Mutating
// the defaults profile in place is enough for `setDefaults` to take effect —
// no retrack-all walk.
//
// Layout per slot: stride = SLOT_STRIDE floats.
//   [0]  v1                 latest server value (damped target; fallback when ring empty)
//   [1]  auxV               mode-multiplexed smoothing state:
//                              damped       → current EMA value
//                              extrapolate  → predict-then-smooth output
//                              lerp         → unused
//   [2]  auxT               timestamp of the last frame that advanced auxV
//   [3]  profileIdx         index into `profileBuf` for this slot's config
//   [4]  refId              schema refId this slot belongs to (self-describing)
//   [5]  fieldId            schema field index this slot predicts
//   [6]  ringHead           next write index into the snapshot ring (0..RING_CAP-1)
//   [7]  ringCount          number of valid entries (0..RING_CAP)
//   [8..]                   RING_CAP × (t, v) interleaved snapshots
//                              (used by both lerp and extrapolate)
//
// refId / fieldId make the slot self-describing: given only a slot id, the
// engine can recover its (refId, fieldId) without touching any JS object. This
// is what lets every mode's read collapse to a pure `(slotId) -> number`
// computer — reckon reads `simByRef[refId]` and `raw` reads SLOT_V1, neither
// needing the instance handed in.
//
// Sample updates write a few floats in place — zero allocation on the hot
// path. The ring is a fixed circular buffer; pushing past capacity overwrites
// the oldest entry via head wrap, so there is no O(n) shift like Array.shift.
//
// Damped and extrapolate are mutually exclusive per slot (the profile picks
// the mode), so they share auxV / auxT instead of carrying separate fields.
const RING_CAP = 16;
const SLOT_V1 = 0;
const SLOT_AUX_V = 1;
const SLOT_AUX_T = 2;
const SLOT_PROFILE = 3;
const SLOT_REF = 4;
const SLOT_FIELD = 5;
const SLOT_RING_HEAD = 6;
const SLOT_RING_COUNT = 7;
const SLOT_RING_BASE = 8;
const SLOT_STRIDE = SLOT_RING_BASE + RING_CAP * 2; // 8 + 32 = 40

// Idle-resume gap collapse (see the listener). Colyseus delta-encodes, so a
// field that stops changing (a player standing still, y while grounded) emits
// NO samples — the ring goes stale. When samples resume there's a huge time
// gap between the last idle sample and the first motion sample; left alone,
// lerp/extrapolate interpolate across it and the entity crawls for ~delay ms
// ("starts, pauses, then walks") before snapping to real speed. We detect the
// gap RELATIVE to the most recent normal inter-arrival interval (so genuinely
// sparse-but-regular streams are NOT collapsed) and pull the previous sample's
// timestamp forward to one normal interval before the resume, so playback
// continues at the real cadence with no crawl.
const GAP_RESUME_MULT = 3;      // collapse when gap > MULT × recent interval (cadence unknown)
// When the server's patch cadence is known (clock.patchInterval), collapse a
// gap past ~1.5 patches: on the jitter-free server-time axis a moving field
// gets a sample EVERY patch, so a longer gap means it went idle. This catches
// short pauses that MULT × the (rate-scaled) measured interval misses when
// patchRate ≠ tickRate — the rewind records every patch, so the client must
// HOLD across an idle gap to match it (lag-comp "what you see is what you hit").
const GAP_RESUME_PATCH_MULT = 1.5;
const GAP_RESUME_MAX_MS = 250;  // cap the synthesized resume span (safety)

// Profile table — packed Float64Array, stride 5. Profile 0 is the Predict's
// *defaults* (mutable; setDefaults edits it in place). Profiles 1..N are
// *frozen* per-call configs, allocated when an attach overrides any defaults.
// Frozen profiles are value-deduplicated via `profileKeys` so that an
// attachAll on a thousand entities sharing the same override still allocates
// just one extra profile, not a thousand.
const PROFILE_STRIDE = 6;
const P_MODE = 0;
const P_DELAY = 1;
const P_DAMPING = 2;
const P_MAX_EXTRAPOLATE = 3;
const P_TICK_INTERVAL = 4;
const P_SNAP = 5;
const DEFAULTS_PROFILE = 0;

const MODE_LERP = 0;
const MODE_EXTRAPOLATE = 1;
const MODE_DAMPED = 2;
const MODE_RECKON = 3;
const MODE_RAW = 4;
/** Internal-only: the slot's value is a rollback controller's pose read (the
 *  bound overlay `predict.sim`/`predict.reconciler` install for their bound
 *  instances). Not a user-selectable {@link PredictMode} — absent from
 *  MODE_CODES; profiles carrying it are allocated by `installBoundOverlay`. */
const MODE_BOUND = 5;
/** Subset that's purely slot-driven (vs. reckon which also reads `simByRef`). */
type SmoothingMode = "lerp" | "extrapolate" | "damped";
const MODE_CODES: Record<PredictMode, number> = {
    lerp: MODE_LERP,
    extrapolate: MODE_EXTRAPOLATE,
    damped: MODE_DAMPED,
    reckon: MODE_RECKON,
    raw: MODE_RAW,
};

/**
 * Stepped-prediction API: the ergonomic on-ramp for dead reckoning.
 *
 * You already have a pure `step(state, dt, elapsedMs)` function that runs on
 * the server tick. Pass the *same* function to `predict.trackStepped(...)`
 * (or via `attach({ kind: "reckon", step, ... })`) and the client advances a
 * scratch copy of the entity forward by `forwardMs` in small substeps, then
 * predict-then-smooths the result.
 *
 * `forwardMs` / `elapsedMs` default to reading from the Predict's clock —
 * most callers never touch them.
 */
export interface SteppedOptions<T = any> {
    /** Fields that `value(instance, field)` should return predicted values for. */
    fields: readonly (keyof T & string)[];
    /** The pure step function. Mutates the provided scratch object in place. */
    step: (state: T, dt: number, elapsedMs: number) => void;
    /** How far past the snapshot to predict, in ms. Defaults to the snapshot
     *  AGE (`serverNow() − clock.lastServerTime()`) — forwards a remote entity
     *  to its current server position. Override for a different horizon. */
    forwardMs?: () => number;
    /** Server time for time-keyed formulas (sinusoids etc). Defaults to `clock.serverNow()`. */
    elapsedMs?: () => number;
    /** Predict-then-smooth damping. Default 20 (~50 ms half-life). 0 = snap. */
    smoothing?: number;
    /** Substep length in ms. Smaller = more accurate bounces / collisions. Default 16. */
    substep?: number;
    /** Rebase discontinuities larger than this pop instead of decaying out —
     *  see {@link SmoothingOptions.snap}. 0 disables (default). */
    snap?: number;
    /** Override how the per-frame scratch is built. Defaults to copying every
     *  schema field through its accessor (or a plain spread for non-schema
     *  objects). Override only for exotic instances the default can't clone. */
    snapshot?: (instance: T) => T;
}

/**
 * Options for {@link Predict.spawns} — the {@link PredictedSpawnsOptions}
 * store options plus optional dead-reckoning of the collection's confirmed
 * entities, replacing a separate `attachAll(key, { mode: "reckon", … })` for
 * spawn-style collections.
 */
export interface PredictSpawnsOptions<S = unknown, L = Partial<S>, D = undefined>
    extends PredictedSpawnsOptions<S, L, D> {
    /**
     * Dead-reckon confirmed entities on these fields, using the same `step`
     * that advances pending locals. Each confirmed entity gets a reckon slot
     * (readable via `predict.value()` or, uniformly across the handoff, the
     * store's `value()`): foreign entities forward to server-present
     * (snapshot age); owned ones additionally forward by the entry's measured
     * input lead when {@link PredictedSpawnsOptions.spawnTime} is set.
     */
    fields?: readonly (keyof S & string)[];
    /** Reckon smoothing for confirmed entities. Default 0 — a deterministic
     *  constant-step projectile rebases exactly, so smoothing only adds lag. */
    smoothing?: number;
    /** Reckon substep in ms (see {@link SteppedOptions.substep}). */
    substep?: number;
}

/**
 * Low-level entity-level forward prediction. Use when your motion doesn't
 * fit the `step(state, dt, elapsed)` shape — e.g. a closed-form formula or a
 * non-temporal query. For the usual case prefer {@link SteppedOptions}.
 */
export interface SimulateOptions<T = any> {
    /** Fields on `instance` that `advance` forecasts and `value()` reads. */
    fields: readonly (keyof T & string)[];
    /** How far past `now` to predict, in ms. Called every frame. Typical: client RTT (or a smoothed RTT). */
    forwardMs: () => number;
    /**
     * Forecast function. Reads current values off `instance`, writes the
     * predicted value of `fields[k]` into `out[k]` (SoA — indexed by field
     * position, NOT keyed by name, so the predict-then-smooth path stays
     * monomorphic). `out` is a reused buffer; fill every slot each call.
     *
     * `endElapsed` is the absolute server-time (ms) the prediction window ends
     * at (`serverNow()` for the per-frame reckon; an arbitrary instant when read
     * via {@link Predictor.valueAt}); the window spans `[endElapsed − forwardMs,
     * endElapsed]`. Ignore it for purely forward, time-independent motion.
     */
    advance: (instance: T, forwardMs: number, out: Float64Array, endElapsed: number) => void;
    /**
     * Absolute server-time (ms) provider for the prediction window end. Defaults
     * to `clock.serverNow()`. Only matters for `valueAt` / time-sampled motion.
     */
    elapsedMs?: () => number;
    /**
     * Damping for predict-then-smooth (spring constant, same units as the
     * `damped` mode). Default 20 (~50 ms half-life). Set to 0 to snap directly
     * to the `advance` output every frame.
     */
    smoothing?: number;
    /** Rebase discontinuities larger than this pop instead of decaying out —
     *  see {@link SmoothingOptions.snap}. 0 disables (default). */
    snap?: number;
}

interface SimState {
    /** Live schema instance — held so `computeReckon` can run `advance` from
     *  a slot id alone (the read path no longer receives the instance). Cleared
     *  on detach, so its lifetime tracks the entity's tracked window. */
    instance: any;
    /** Field indices, parallel to the SoA buffers below (position k ↔ field). */
    fieldIds: number[];
    /** fieldId → position in the SoA buffers (or -1). Sized to max fieldId + 1
     *  so `computeReckon` maps a slot's SLOT_FIELD to its position with one
     *  array index instead of `fieldIds.indexOf(...)`. */
    posOf: Int8Array;
    forwardMs: () => number;
    /** Absolute server-time (ms) the prediction window ENDS at — `serverNow()`
     *  for the per-frame render reckon, an arbitrary instant for `valueAt`. */
    elapsedMs: () => number;
    /** `endElapsed` is the absolute time of the window end (the last substep
     *  lands on it) so time-sampled step fns read the right instant; the window
     *  spans `[endElapsed − forwardMs, endElapsed]`. */
    advance: (instance: any, forwardMs: number, out: Float64Array, endElapsed: number) => void;
    smoothing: number;
    /** Value-space discontinuity threshold — rebase jumps beyond it skip the
     *  offset capture (pop, don't glide). 0 = off. */
    snap: number;
    /** Displayed values (= `out + offset`), indexed by field position. */
    smoothed: Float64Array;
    /** Reused per-frame `advance` output, indexed by field position. */
    out: Float64Array;
    /** Reused scratch for `valueAt` — a one-off reckon to an arbitrary instant
     *  that must NOT clobber the per-frame render reckon in `out`/`smoothed`. */
    valueOut: Float64Array;
    /** Pop-hiding correction offset, decaying toward 0 (see applySimulation). */
    offset: Float64Array;
    /** Previous frame's `out` — lets a clean frame measure per-field motion so a
     *  rebase can subtract the expected motion from its offset capture. */
    outPrev: Float64Array;
    /** Per-ms field velocity from the last CLEAN (non-rebase) frame — the
     *  expected-motion term a rebase multiplies by the frame dt so one frame of
     *  genuine motion isn't mis-captured as a discontinuity. */
    frameVel: Float64Array;
    /** Snapshot identity (`clock.lastServerTime()`) at the last apply — a
     *  change marks a REBASE: the forward sim now starts from new data, so any
     *  discontinuity is captured into `offset`. NaN = no clock → EMA fallback. */
    lastBaseT: number;
    lastApplyTime: number;   // -Infinity until first `value()` call
}

/** Smoothing-mode defaults applied when callers omit specific fields. */
const SMOOTHING_DEFAULTS: Required<SmoothingOptions> = {
    mode: "lerp",
    delay: 100,
    damping: 15,
    maxExtrapolate: 200,
    tickInterval: 0,
    snap: 0,
    angle: false,
};

/** Reckon-mode defaults. `step` stays undefined — must be supplied at construct time
 *  or per-attach; otherwise `attach`/`attachAll` throws. */
interface ReckonDefaults {
    step: ((state: any, dt: number, elapsedMs: number) => void) | undefined;
    smoothing: number;
    substep: number;
    snap: number;
}
const RECKON_DEFAULTS: ReckonDefaults = {
    step: undefined,
    smoothing: 20,
    substep: 16,
    snap: 0,
};


// Loose typing: accept anything `Callbacks.get` accepts (Room, Decoder, etc.)
type CallbacksInput = Parameters<typeof Callbacks.get>[0];

/**
 * Extract the root state type from a Room / Decoder / Callbacks input.
 * Used by `Predict.get(room)` so the returned `Predict<TState>` can offer
 * a root-level `attachAll(key, config)` overload narrowed to `TState`'s
 * collection-valued keys.
 */
type StateOf<R> = R extends { state: infer S } ? S : any;

// -----------------------------------------------------------------------------
// Attach config — declarative shape consumed by Predict.attach / attachAll.
// -----------------------------------------------------------------------------

/** Per-field smoothing: either a mode shorthand or full {@link SmoothingOptions}. */
export type FieldSmoothing = "lerp" | "extrapolate" | "damped" | SmoothingOptions;

/**
 * Smoothing config — flat per-field map: `{ x: "lerp", y: { mode: "damped" } }`.
 * Field names are checked against `T`'s numeric keys, so a typo or non-numeric
 * field is a compile error.
 */
export type SmoothingConfig<T = any> = Partial<Record<NumericKeys<T>, FieldSmoothing>>;

/**
 * Reckon attach config — apply dead-reckoning to `fields` using a step
 * function. `step` can be omitted if the parent Predict was constructed
 * with `mode: "reckon"` + a `step` default (it falls back); when missing on
 * both, `attach` / `attachAll` throws.
 */
export interface ReckonAttachConfig<T = any> {
    /**
     * Per-attach mode. Falls back to the Predict's `defaultMode` when omitted.
     * The client's display mode is declared HERE, independently of the server's
     * rewind `mode` — keep them aligned ("what you see is what you hit"): render
     * targets the server rewinds `mode:"reckon"` with `mode:"reckon"` here, and
     * those it rewinds `mode:"snapshot"` with an interpolating mode (`lerp` /
     * `damped`). Common patterns:
     *   - `mode: "lerp"` → smoothing-only attach (no sim state allocated).
     *   - `mode: "reckon"` → reckon attach (requires `step` here or in Predict).
     *   - omitted → the Predict's `defaultMode`.
     * Per-attach overrides go through the same profile system as the defaults
     * (the slot's `SLOT_PROFILE` points at a frozen profile encoding the
     * mode + opts), so dispatch is uniform and the panel sub-card can tune
     * the override at runtime.
     */
    mode?: PredictMode;
    /** Numeric fields of `T` to predict. */
    fields: readonly NumericKeys<T>[];
    /** Step function. Falls back to the Predict's constructor-time default. */
    step?: (state: T, dt: number, elapsedMs: number) => void;
    /** Predict-then-smooth damping. Defaults to the Predict's setting (or 20). */
    smoothing?: number;
    /** Substep length in ms. Defaults to the Predict's setting (or 16). */
    substep?: number;
    /** Value-space discontinuity threshold, applied to every field here — a
     *  per-sample jump beyond it snaps instead of smoothing (teleports:
     *  respawn, blink, warp). See {@link SmoothingOptions.snap}. Default 0 (off). */
    snap?: number;
    /** Treat every field here as a radian ANGLE — see {@link SmoothingOptions.angle}.
     *  Use only on smoothing-mode attaches (lerp/damped/extrapolate), not reckon. */
    angle?: boolean;
    /**
     * Override how the per-frame reckon scratch is built. Leave unset for the
     * default fast path (a pooled schema instance refilled via `$values` by
     * index — monomorphic, zero-alloc). Provide one only for non-schema
     * instances or to copy a custom field subset; a custom snapshot uses the
     * generic (slower, dynamic-key) advance path.
     */
    snapshot?: (state: T) => T;
}

export type AttachConfig<T = any> = SmoothingConfig<T> | ReckonAttachConfig<T>;

/** One MODE_BOUND overlay slot's backing: the controller pose read
 *  (`ctrl.value(key)`) plus the stashed passive slot it displaced (-1 = none),
 *  restored when the controller disposes. */
interface BoundSlotEntry {
    ctrl: { value(field: string): number };
    key: string;
    stash: number;
}

/** The controller face the bound overlay consumes — implemented by both
 *  {@link Reconciler} and {@link SimReconciler}. `boundRegistrations` lists the
 *  decoded instances the controller predicts (one entry per bound world part;
 *  `fields`/`poseKeys` parallel — the overlay maps `predict.value(source,
 *  fields[i])` to `ctrl.value(poseKeys[i])`). */
interface BoundController {
    value(field: string): number;
    onDisposed(hook: () => void): void;
    readonly boundRegistrations: ReadonlyArray<{
        source: object; fields: readonly string[]; poseKeys: readonly string[];
    }>;
}

function isReckonAttachConfig<T>(cfg: AttachConfig<T>): cfg is ReckonAttachConfig<T> {
    if (cfg === null || typeof cfg !== "object") return false;
    return Array.isArray((cfg as Partial<ReckonAttachConfig<T>>).fields);
}

/**
 * Resolved attach config for one group. Built ONCE per `attachAll` (profiles
 * allocated up front, labeled by the collection key) and reused for every
 * child, so a 1000-item collection allocates one profile, not 1000 — and the
 * profile is the group's own, never the mutable default #0 that the panel
 * mutates. Each child just references the pre-resolved profile ids.
 */
interface GroupPlan {
    label: string;
    /** True when the group runs dead-reckoning (allocates a SimState per child). */
    isReckon: boolean;
    reckonFields?: readonly string[];
    reckonStep?: (state: any, dt: number, elapsedMs: number) => void;
    reckonSmoothing?: number;
    reckonSubstep?: number;
    reckonSnap?: number;
    reckonSnapshot?: (state: any) => any;
    /** Field → profile id (+ angle flag). All children of the group share these. */
    fieldProfiles: Array<{ field: string; profileIdx: number; angle?: boolean }>;
}

/**
 * One attach()/attachAll() group. The base plan (today's one-plan-per-group)
 * is built eagerly; children whose TYPE resolves identically reuse it, so
 * homogeneous collections behave exactly as before. A child type whose field
 * set differs (missing some configured fields) gets its own lazily-built
 * sub-plan/profile labeled `label:TypeName` — mixed-type collections resolve
 * per constructor, and each type surfaces as its own debug-panel card.
 */
interface AttachGroup {
    label: string;
    config: AttachConfig<any>;
    basePlan: GroupPlan;
    /** Resolved plan per child constructor (lazily filled). */
    planByCtor: Map<Function, GroupPlan>;
}

// -----------------------------------------------------------------------------
// Predict — the single per-room prediction class.
// -----------------------------------------------------------------------------

/**
 * Options passed to {@link Predict.get}. Intersects {@link PredictOptions}
 * with extra construction-time fields. The common case — picking the
 * default mode — is a flat one-liner:
 *
 *     Predict.get(room, { mode: "lerp",   delay: 80 });
 *     Predict.get(room, { mode: "reckon", step: stepEnemy, smoothing: 25 });
 *
 * Type alias (not interface) because PredictOptions is a discriminated union
 * and interface-extends-union isn't permitted in TS.
 */
export type PredictGetOptions<T = any> = PredictOptions<T> & {
    /**
     * Clock used as the default for `trackStepped`'s `forwardMs` / `elapsedMs`.
     * Falls back to `room.clock` (allocated by the SDK when the server called
     * `defineInput()`). When neither is available, `trackStepped` callers must
     * pass explicit `forwardMs` / `elapsedMs`.
     */
    clock?: RoomClockLike;
    /**
     * Draw dead-reckoned (`mode:"reckon"`) entities on the clock's SLEW-LIMITED
     * **render** timeline ({@link RoomClockLike.renderNow}) instead of the raw
     * {@link RoomClockLike.serverNow}. Both the reckon horizon (snapshot age)
     * and the time-sampled absolute clock (`elapsedMs`, for closed-form motion
     * like sinusoids) then read `renderNow()`, so the per-patch offset-EMA
     * wobble stops showing as `v·Δclock` stutter on remote entities.
     *
     * **ON by default** (when the clock implements `renderNow()`; falls back to
     * `serverNow()` otherwise). It affects ONLY what you SEE: the lag-comp hit
     * path (`valueAt(when)` with an explicit instant) bypasses it and keeps
     * stamping on accurate `serverNow()`, so "what you see is what you hit"
     * holds in steady state — the render timeline just smooths the draw.
     *
     * Pass `false` to force the raw `serverNow()` horizon. The one reason to:
     * strict draw==hit WYSIWYG on a fast twitch game, where you want the drawn
     * position to equal the hit position even DURING an offset correction (the
     * slew briefly lags the draw behind the `serverNow()`-stamped hit; racing /
     * platformer don't care, a competitive shooter might).
     */
    renderPresent?: boolean;
    /**
     * Human-friendly identifier shown in `@colyseus/sdk/debug` panels and
     * useful for logging. Falls back to `predict#N` (incremented per process).
     */
    name?: string;
};

// -----------------------------------------------------------------------------
// Introspection registry — `@colyseus/sdk/debug` installs a tiny
// `globalThis.__colyseusDebug.publish()` receiver. Predict publishes a stable,
// engine-level *core* handle to it at construction so the debug layer can build
// its panel from OUTSIDE the engine. The handle exposes only portable engine
// state (profiles, defaults, attached count) plus an `onTrack` subscription —
// NO panel-shaped data (e.g. "which fields use a profile") lives here; the
// debug bridge in `@colyseus/sdk/debug` derives that itself. When the registry
// is absent (prod build, debug not imported), publishing is a no-op and Predict
// carries no debug state at all.
// -----------------------------------------------------------------------------

/**
 * Stable engine-introspection contract Predict publishes. Deliberately scoped
 * to portable engine state so a future C# / C port can expose the same surface;
 * the debug *panel* shape (per-profile field labels etc.) is assembled in
 * `@colyseus/sdk/debug` from this core, not here.
 */
/** Per-reconciler drift snapshot published to the debug panel. */
export interface ReconcilerStat {
    /** Display label (index-based — most games drive a single reconciler). */
    readonly label: string;
    /** The actionable read: matched / jitter / diverging (see classifyDrift). */
    readonly status: DriftStatus;
    /** `ema / tolerance` when a `warnOnDivergence` tolerance is set — how far past
     *  the dev's own threshold the persistent drift sits. `undefined` otherwise. */
    readonly severity?: number;
    /** Rolling drift EMA — the persistent/divergence component. */
    readonly ema: number;
    /** Rolling drift peak — recent jitter spikes. */
    readonly peak: number;
    /** Most recent reconcile's max |correction| (world/pose units). */
    readonly lastCorrectionMag: number;
    /** Reconcile counter — advances once per reconcile. */
    readonly reconcileSeq: number;
}

export interface PredictCore {
    readonly name: string;
    readonly mode: () => PredictMode;
    readonly smoothingDefaults: () => {
        mode: PredictMode;
        delay: number;
        damping: number;
        maxExtrapolate: number;
        tickInterval: number;
    };
    readonly reckonDefaults: () => Readonly<ReckonDefaults>;
    /** Number of instances currently attached. */
    readonly attachedCount: () => number;
    /** Drift telemetry for each driven reconciler/sim — the panel renders a
     *  per-reconciler divergence-vs-jitter readout. Empty when this Predict
     *  drives only passive smoothing. */
    readonly reconcilers: () => ReconcilerStat[];
    /** Mutate defaults. Mode flips across families freely. */
    readonly setDefaults: (opts: PredictOptions) => void;
    /**
     * Snapshot every profile currently registered with this Predict. The debug
     * panel renders one sub-card per non-default profile so per-field overrides
     * (e.g. `{ vx: { mode: "extrapolate" } }`) become tunable without code edits.
     */
    readonly profiles: () => ProfileCore[];
    /**
     * Mutate a specific profile in place. Slots whose `SLOT_PROFILE` points
     * at `id` pick up the change next frame. Setting `mode` swaps the
     * `profileComputers[id]` function pointer in lock-step. Mode accepts any
     * of the five `PredictMode` values.
     */
    readonly setProfile: (id: number, opts: { mode?: PredictMode } & SmoothingOptions) => void;
    /**
     * Subscribe to track events: fires `(profileIdx, field)` each time a field
     * is tracked under a profile. The debug bridge uses this to build the
     * profile → field-names mapping it displays, so that panel-only mapping
     * never has to live in the engine. Returns an unsubscribe fn.
     */
    readonly onTrack: (cb: (profileIdx: number, field: string) => void) => () => void;
    /** Unsubscribe when the Predict is disposed. */
    readonly onDispose: (cb: () => void) => () => void;
}

/** Read-only snapshot of one profile (engine state; no panel-only fields). */
export interface ProfileCore {
    readonly id: number;
    readonly isDefault: boolean;
    /** Attach-group label this profile belongs to (the collection key passed to
     *  `attachAll`, or "(attach)" for standalone attaches). The panel renders
     *  one card per (label, mode) so each group is tuned independently. */
    readonly label: string | undefined;
    readonly mode: PredictMode;
    readonly delay: number;
    readonly damping: number;
    readonly maxExtrapolate: number;
    readonly tickInterval: number;
    readonly snap: number;
}

let __predictAutoId = 0;

let __warnedNoInputClock = false;
/** Warn once when a {@link Predict} inherits the inert {@link NULL_CLOCK} — the
 *  server room never called `defineInput()`, so server-time interpolation and
 *  lag compensation silently fall back to local time. */
function warnNoInputClock(): void {
    if (__warnedNoInputClock) { return; }
    __warnedNoInputClock = true;
    console.warn(
        "@colyseus/sdk Predict: room.clock isn't server-synced because the server " +
        "room didn't call defineInput(). Server-time interpolation and lag " +
        "compensation fall back to local time. Add defineInput() on the server " +
        "room to enable them — or ignore this if you only need local smoothing.",
    );
}

export class Predict<TState = any> {
    /**
     * Factory mirroring `Callbacks.get(room)`. Each call returns a fresh
     * Predict — instantiate multiple for side-by-side comparison overlays.
     * `TState` is inferred from `room.state` so `attachAll(key, config)` can
     * narrow `key` to the root state's collection-valued properties.
     */
    static get<R extends CallbacksInput>(room: R, opts: PredictGetOptions = {}): Predict<StateOf<R>> {
        return new Predict<StateOf<R>>(room, opts);
    }

    // Loose-typed callbacks wrapper. Forwards to `Callbacks.get(room)` whose
    // own overloads accept either `(key, cb)` for root state or
    // `(parent, key, cb)` for nested collections.
    private callbacks: {
        onAdd: (...args: any[]) => () => void;
        onRemove: (...args: any[]) => () => void;
        listen: (instance: any, field: string, cb: (v: any) => void, immediate?: boolean) => () => void;
    };
    // SoA storage for smoothing slots. `slotBuf` holds all slots packed at
    // `slotIdx * SLOT_STRIDE`. `slotByRef` maps refId → (field NAME → slot idx).
    // Keying the inner map by field name (not index) means the hot `value()`
    // read resolves a slot with two plain Map.gets and NEVER touches schema
    // metadata — no per-frame name→index resolution (that was a megamorphic
    // keyed load). `slotDetach[idx]` holds the listen()-returned unsubscribe
    // (parallel array, not packed in `slotBuf` since closures aren't numbers).
    // Recycled indices live in `freeSlots`; the buffer doubles when `slotCount`
    // outgrows capacity.
    //
    // Keyed on the schema's integer refId, not JS object identity — the same
    // key the wire protocol and a C / C# port would use. Entries are removed on
    // detach (which fires from onRemove before the decoder can recycle a
    // refId), so a reused refId never collides with a stale entry.
    private slotBuf: Float64Array = new Float64Array(64 * SLOT_STRIDE);
    private slotCount: number = 0;
    private slotDetach: Array<(() => void) | undefined> = [];
    // Per-slot angle flag (parallel to slotDetach). Marks slots whose samples are
    // stored unwrapped so the interpolators handle the ±π seam — see `angle` option.
    private slotAngle: boolean[] = [];
    private freeSlots: number[] = [];
    private slotByRef = new Map<number, Map<string, number>>();
    private simByRef = new Map<number, SimState>();
    /** MODE_BOUND side table: overlay slot → its {@link BoundSlotEntry}. An
     *  entry here marks the slot as a controller overlay; teardown paths branch
     *  on membership (see untrackSlot / detachByRef / registerBound). */
    private boundBySlot = new Map<number, BoundSlotEntry>();
    /** The one shared MODE_BOUND profile (lazily allocated). Bound slots carry
     *  no tunable params and the panel's per-controller cards come from
     *  {@link snapshotReconcilers}, so per-controller profiles would only
     *  accumulate (profiles are never freed — a respawn loop would leak them). */
    private boundProfileIdx = -1;
    private renderTime = 0;
    private defaultMode: PredictMode;
    private reckonDefaults: ReckonDefaults;
    private clock: RoomClockLike | undefined;
    /** Draw reckon entities on the clock's render timeline — see the
     *  `renderPresent` option on {@link PredictGetOptions}. */
    private useRenderClock = false;

    // --- Room-wide fixed-step accumulator (drives reconciler input pacing) ------
    // The server's tick rate is one value per room, so one accumulator here is the
    // single source of truth: `tick(now)` converts elapsed render time into the
    // whole number of fixed input ticks due (returned to the caller's send loop).
    // `stepMs` is adopted from the first reconciler spawned (its input handle
    // advertises the server rate); until then no fixed step is known and `tick`
    // returns 0. (Render interpolation is NOT derived here — each reconciler eases
    // it off its own last-step time, so it holds correctly when that entity's input
    // pauses; see RollbackController.renderAlpha.)
    private fixedStepMs: number | undefined;
    private stepAcc = 0;
    private lastFrameNow = -1;
    /** Spiral-of-death guard: cap fixed steps emitted per frame (after a hitch,
     *  drop the backlog rather than chase it). */
    private static readonly MAX_STEPS_PER_FRAME = 5;

    // Profile table. Profile 0 is the defaults (mutable via setDefaults).
    // Subsequent indices are frozen, value-deduped via `profileKeys`.
    private profileBuf: Float64Array = new Float64Array(8 * PROFILE_STRIDE);
    private profileCount: number = 0;
    private profileKeys = new Map<string, number>();
    /**
     * Human label per profile, indexed by profile id. Set from the attach
     * group's key (collection name) so the debug panel can render one card per
     * group ("enemies", "players") instead of an anonymous, cross-wired
     * per-Predict mode toggle. The label is also part of the dedup key, so two
     * different groups never share a profile even if their params match —
     * tuning one group's card can't bleed into another's.
     */
    private profileLabels: Array<string | undefined> = [];
    /**
     * Per-profile read function — resolved once at profile allocation (or
     * when `setDefaults`/`setProfile` flips a profile's mode) and stored
     * here. Slot reads dispatch via `profileComputers[profileIdx](slotIdx)`
     * instead of an `if (mode === ...)` chain at each `value()` call.
     *
     * Every mode reads purely from the slot: the slot's SLOT_REF / SLOT_FIELD
     * let `reckon` find its SimState and `raw` read SLOT_V1, so no instance or
     * field-name is threaded through. This pure `(slotId) -> number` shape is
     * exactly a C function-pointer table / C# delegate array.
     */
    private profileComputers: Array<(slotIdx: number) => number> = [];
    /**
     * Track-event listeners. The debug bridge subscribes via the published
     * core's `onTrack`; on the cold attach path each `trackWithProfile` notifies
     * them with `(profileIdx, field)` so the bridge can build its profile→fields
     * view WITHOUT the engine holding any panel-shaped state. Empty in prod (no
     * debug registry ⇒ never subscribed), so the per-track notify is a length
     * check on a cold path.
     */
    private trackListeners: Array<(profileIdx: number, field: string) => void> = [];

    /** Public name (shown in the debug panel and useful for logs). */
    readonly name: string;
    private disposeListeners: Array<() => void> = [];
    /**
     * Child primitives spawned by {@link events} / {@link controller} that this
     * Predict drives from its own {@link tick}. The Predict is the single
     * per-frame driver for the whole prediction stack — one `predict.tick(now)`
     * advances smoothing AND every controller AND prunes every event store, so
     * callers can't forget to tick/prune a child (a forgotten drive is a silent
     * visual bug). Children expose their own `tick`/`prune` for standalone use;
     * a `dead` child is dropped on the next tick.
     */
    private driven: Array<{ tick?(now: number): void; prune?(): void; dead?: boolean }> = [];

    private constructor(room: CallbacksInput, opts: PredictGetOptions) {
        this.callbacks = Callbacks.get(room as any) as any;
        const { clock, ...rest } = opts as PredictGetOptions & Record<string, any>;
        // Determine the predictor's *default* prediction style. Per-attach
        // overrides can still switch to a different mode.
        this.defaultMode = (rest.mode ?? "lerp") as PredictMode;
        // Always materialize a defaults profile at index 0 — even on a
        // reckon-default or raw-default Predict, callers may flip the mode
        // back to a smoothing mode later and the profile needs to exist.
        const isSmoothingDefault =
            this.defaultMode !== "reckon" && this.defaultMode !== "raw";
        const initial: Required<SmoothingOptions> = isSmoothingDefault
            ? (() => {
                const s = rest as SmoothingOptions;
                return {
                    mode: (s.mode ?? SMOOTHING_DEFAULTS.mode) as SmoothingMode,
                    delay: s.delay ?? SMOOTHING_DEFAULTS.delay,
                    damping: s.damping ?? SMOOTHING_DEFAULTS.damping,
                    maxExtrapolate: s.maxExtrapolate ?? SMOOTHING_DEFAULTS.maxExtrapolate,
                    tickInterval: s.tickInterval ?? SMOOTHING_DEFAULTS.tickInterval,
                    snap: s.snap ?? SMOOTHING_DEFAULTS.snap,
                    angle: s.angle ?? SMOOTHING_DEFAULTS.angle,
                };
            })()
            : { ...SMOOTHING_DEFAULTS };
        // Allocate profile 0 (defaults). Its MODE is the Predict's actual
        // `defaultMode` (reckon/raw included) — NOT lerp. Seeding it as lerp was
        // the quirk that let a lerp group silently collapse onto the default
        // profile. The smoothing PARAMS are still seeded from defaults so a
        // later flip to a smoothing mode (via setDefaults) has sane values.
        // `dedup: false` because we mutate this profile in place via setDefaults;
        // deduping would conflate it with a frozen profile of the same values.
        const dIdx = this.allocProfile(
            this.defaultMode,
            initial.delay,
            initial.damping,
            initial.maxExtrapolate,
            initial.tickInterval,
            initial.snap,
            false,
        );
        // The first allocProfile is guaranteed to land at index 0 — invariant
        // relied on by SLOT_PROFILE writes that fall back to "use defaults".
        if (dIdx !== DEFAULTS_PROFILE) {
            throw new Error("Predict: defaults profile must be at index 0");
        }
        if (this.defaultMode === "reckon") {
            const r = rest as ReckonOptions;
            this.reckonDefaults = {
                step: r.step,
                smoothing: r.smoothing ?? RECKON_DEFAULTS.smoothing,
                substep: r.substep ?? RECKON_DEFAULTS.substep,
                snap: r.snap ?? RECKON_DEFAULTS.snap,
            };
        } else {
            this.reckonDefaults = { ...RECKON_DEFAULTS };
        }
        // Prefer caller-supplied clock; otherwise inherit `room.clock` (set
        // by the SDK when the server called `defineInput()`). Stays undefined
        // for rooms without a clock — `trackStepped` then requires explicit
        // forwardMs/elapsedMs.
        this.clock = clock ?? (room as { clock?: RoomClockLike | null }).clock ?? undefined;
        // Default ON: reckon draws on renderNow() when the clock offers it
        // (presentFn falls back to serverNow otherwise). `false` forces raw.
        this.useRenderClock = (rest as { renderPresent?: boolean }).renderPresent !== false;
        // Prediction wants a server-synced clock (server-time interpolation,
        // lag-comp render stamps). It only exists once the room called
        // defineInput(); inheriting the inert stub means that didn't happen.
        if (this.clock === NULL_CLOCK) { warnNoInputClock(); }

        this.name = (rest as { name?: string }).name ?? `predict#${++__predictAutoId}`;

        // Publish a core handle to the debug channel. `publishDebug` renders it
        // now if `@colyseus/sdk/debug` is loaded, else BUFFERS it for replay when
        // the overlay's (dev-only, dynamic) import lands — so a Predict created
        // before that import still shows up. Prod pays nothing: no overlay ⇒ a
        // bounded WeakRef buffer nothing ever reads (and `trackWithProfile`'s
        // notify stays a length check, `attachedCount` an already-maintained map).
        publishDebug("predict", this.makeCoreHandle());
    }

    /**
     * Predictor's current default mode. Reflects mutations via {@link setDefaults}
     * (and therefore the SDK debug panel), so consumers that need to react to
     * mode changes can read this each frame.
     */
    get mode(): PredictMode {
        return this.defaultMode;
    }

    /**
     * The "present" instant provider for reckon horizons + time-sampling (the
     * `forwardMs` snapshot-age and the `elapsedMs` absolute clock). Unless
     * {@link PredictGetOptions.renderPresent} was set `false`, and when the clock
     * implements {@link RoomClockLike.renderNow}, it's the slew-smoothed render
     * timeline; otherwise the raw {@link RoomClockLike.serverNow}. `undefined`
     * with no clock — {@link trackStepped} then requires explicit
     * forwardMs/elapsedMs. Resolved once on the cold attach path.
     *
     * The lag-comp read (`valueAt` with an explicit `when`) never goes through
     * here, so hit stamps stay on `serverNow()` even with render-present on.
     */
    private presentFn(): (() => number) | undefined {
        const clock = this.clock;
        if (!clock) { return undefined; }
        return this.useRenderClock && clock.renderNow
            ? clock.renderNow.bind(clock)
            : clock.serverNow.bind(clock);
    }

    // --- Core introspection handle ---------------------------------------------

    private makeCoreHandle(): PredictCore {
        return {
            name: this.name,
            mode: () => this.defaultMode,
            smoothingDefaults: () => this.readSmoothingDefaults(),
            reckonDefaults: () => ({ ...this.reckonDefaults }),
            reconcilers: () => this.snapshotReconcilers(),
            // Every attached instance owns ≥1 smoothing slot, so the slot map's key
            // count IS the attached-instance count — no separate bookkeeping needed.
            attachedCount: () => this.slotByRef.size,
            setDefaults: (opts) => this.setDefaults(opts),
            profiles: () => this.snapshotProfiles(),
            setProfile: (id, opts) => this.setProfile(id, opts),
            onTrack: (cb) => {
                this.trackListeners.push(cb);
                return () => {
                    const i = this.trackListeners.indexOf(cb);
                    if (i >= 0) this.trackListeners.splice(i, 1);
                };
            },
            onDispose: (cb) => {
                this.disposeListeners.push(cb);
                return () => {
                    const i = this.disposeListeners.indexOf(cb);
                    if (i >= 0) this.disposeListeners.splice(i, 1);
                };
            },
        };
    }

    /** Drift telemetry for each driven Reconciler/SimReconciler (duck-typed by
     *  the presence of `drift`), for the debug panel. Event/spawn stores in the
     *  same `driven` list have no `drift` and are skipped. */
    private snapshotReconcilers(): ReconcilerStat[] {
        const out: ReconcilerStat[] = [];
        let i = 0;
        for (const d of this.driven) {
            const r = d as Partial<{ drift: Drift; lastCorrectionMag: number; reconcileSeq: number; warnTolerance?: number }>;
            if (!r.drift) { continue; }
            const tol = r.warnTolerance;
            out.push({
                label: `reconciler #${i++}`,
                status: classifyDrift(r.drift, tol),
                severity: tol !== undefined && tol > 0 ? r.drift.ema / tol : undefined,
                ema: r.drift.ema,
                peak: r.drift.peak,
                lastCorrectionMag: r.lastCorrectionMag ?? 0,
                reconcileSeq: r.reconcileSeq ?? 0,
            });
        }
        return out;
    }

    private readSmoothingDefaults(): { mode: PredictMode; delay: number; damping: number; maxExtrapolate: number; tickInterval: number; snap: number } {
        const p = this.profileBuf;
        const b = DEFAULTS_PROFILE * PROFILE_STRIDE;
        const m = p[b + P_MODE] | 0;
        const mode: PredictMode =
            m === MODE_LERP ? "lerp" :
            m === MODE_EXTRAPOLATE ? "extrapolate" :
            m === MODE_DAMPED ? "damped" :
            m === MODE_RECKON ? "reckon" : "raw";
        return {
            mode,
            delay: p[b + P_DELAY],
            damping: p[b + P_DAMPING],
            maxExtrapolate: p[b + P_MAX_EXTRAPOLATE],
            tickInterval: p[b + P_TICK_INTERVAL],
            snap: p[b + P_SNAP],
        };
    }

    /**
     * Look up or allocate a profile matching the given values. With
     * `dedup=true`, an identical existing profile is reused — so an attachAll
     * over 1000 entities with the same per-field config still allocates one
     * profile, not 1000.
     */
    private allocProfile(
        mode: PredictMode | number,
        delay: number,
        damping: number,
        maxExtrapolate: number,
        tickInterval: number,
        snap: number,
        dedup: boolean,
        label?: string,
    ): number {
        // A numeric mode is an internal code (MODE_BOUND) with no PredictMode name.
        const modeCode = typeof mode === "number" ? mode : MODE_CODES[mode];
        let key = "";
        if (dedup) {
            // Label is part of the key: two groups never share a profile, so
            // their panel cards stay independent.
            key = `${label ?? ""}|${modeCode}|${delay}|${damping}|${maxExtrapolate}|${tickInterval}|${snap}`;
            const existing = this.profileKeys.get(key);
            if (existing !== undefined) return existing;
        }
        const idx = this.profileCount++;
        const needed = (idx + 1) * PROFILE_STRIDE;
        if (needed > this.profileBuf.length) {
            const grown = new Float64Array(this.profileBuf.length * 2);
            grown.set(this.profileBuf);
            this.profileBuf = grown;
        }
        const base = idx * PROFILE_STRIDE;
        this.profileBuf[base + P_MODE] = modeCode;
        this.profileBuf[base + P_DELAY] = delay;
        this.profileBuf[base + P_DAMPING] = damping;
        this.profileBuf[base + P_MAX_EXTRAPOLATE] = maxExtrapolate;
        this.profileBuf[base + P_TICK_INTERVAL] = tickInterval;
        this.profileBuf[base + P_SNAP] = snap;
        this.profileLabels[idx] = label;
        // Resolve the compute function once, here at registration — slot
        // reads then invoke it directly instead of branching on mode.
        this.profileComputers[idx] = this.computerForMode(modeCode);
        if (dedup) this.profileKeys.set(key, idx);
        return idx;
    }

    private computerForMode(modeCode: number): (slotIdx: number) => number {
        if (modeCode === MODE_LERP) return this.computeLerp;
        if (modeCode === MODE_EXTRAPOLATE) return this.computeExtrapolate;
        if (modeCode === MODE_DAMPED) return this.computeDamped;
        if (modeCode === MODE_RECKON) return this.computeReckon;
        if (modeCode === MODE_BOUND) return this.computeBound;
        return this.computeRaw; // MODE_RAW
    }

    /**
     * Resolve a per-track opts shape to a profile index.
     *   - empty opts (no own keys) → defaults profile (0). The slot follows
     *     setDefaults mutations.
     *   - non-empty opts that, after merging with current defaults, match
     *     defaults exactly → defaults profile (0). Equivalent intent, same
     *     internal state.
     *   - non-empty opts that differ from defaults → frozen profile, value-
     *     deduped via `profileKeys`. The slot does NOT follow later
     *     setDefaults mutations (the override is "frozen").
     */
    private profileFromOpts(opts: { mode?: PredictMode } & SmoothingOptions): number {
        if (
            opts.mode === undefined &&
            opts.delay === undefined &&
            opts.damping === undefined &&
            opts.maxExtrapolate === undefined &&
            opts.tickInterval === undefined &&
            opts.snap === undefined
        ) {
            return DEFAULTS_PROFILE;
        }
        const d = this.readSmoothingDefaults();
        const mode = (opts.mode ?? d.mode) as PredictMode;
        const delay = opts.delay ?? d.delay;
        const damping = opts.damping ?? d.damping;
        const maxExtrapolate = opts.maxExtrapolate ?? d.maxExtrapolate;
        const tickInterval = opts.tickInterval ?? d.tickInterval;
        const snap = opts.snap ?? d.snap;
        // Collapse to defaults profile when the merged values match it. This
        // unifies homogeneous per-attach configs (e.g. `{ mode: "lerp" }` on
        // a Predict already at lerp) with the implicit no-override case —
        // ensuring there's exactly one internal state for any given intent.
        if (
            mode === d.mode && delay === d.delay && damping === d.damping &&
            maxExtrapolate === d.maxExtrapolate && tickInterval === d.tickInterval &&
            snap === d.snap
        ) {
            return DEFAULTS_PROFILE;
        }
        return this.allocProfile(mode, delay, damping, maxExtrapolate, tickInterval, snap, true);
    }

    /**
     * Allocate (or reuse, within the same `label`) the profile for an attach
     * group. Unlike {@link profileFromOpts}, this NEVER collapses onto the
     * mutable default profile #0 — each labeled group owns its own profile so
     * the debug panel can tune it in isolation (the fix for the "changing the
     * enemies card moved the players" cross-wire). All children of one
     * `attachAll` share the profile (same label + params ⇒ deduped); different
     * groups never do.
     */
    private groupProfile(
        opts: { mode?: PredictMode; delay?: number; damping?: number; maxExtrapolate?: number; tickInterval?: number; snap?: number },
        label: string,
    ): number {
        const d = this.readSmoothingDefaults();
        const mode = (opts.mode ?? this.defaultMode) as PredictMode;
        return this.allocProfile(
            mode,
            opts.delay ?? d.delay,
            opts.damping ?? d.damping,
            opts.maxExtrapolate ?? d.maxExtrapolate,
            opts.tickInterval ?? d.tickInterval,
            opts.snap ?? d.snap,
            true,
            label,
        );
    }

    /**
     * Mutate the Predict's default options. Within the same mode family
     * (smoothing modes are interchangeable; reckon is its own family). Throws
     * on cross-family switches — create a new Predict instead.
     *
     * Mutations take effect on the next frame for every slot that attached
     * with a default-shaped config (e.g. `{ x: {}, y: {} }`); attaches that
     * explicitly overrode a field (e.g. `{ x: { delay: 50 } }`) snapshot
     * their settings at attach time and are unaffected.
     *
     * Mode flips can cross families freely. The defaults profile (id 0)
     * always encodes the current mode (any of the five), and its computer is
     * swapped in lock-step so `value()` dispatches correctly without further
     * branching.
     */
    setDefaults(opts: PredictOptions): void {
        // Mode handling first — it's the only field that affects routing.
        const newMode = (opts as { mode?: PredictMode }).mode;
        if (newMode !== undefined) {
            this.defaultMode = newMode;
            // Profile 0 always stores the current mode — uniform encoding
            // means slot dispatch follows automatically.
            const base = DEFAULTS_PROFILE * PROFILE_STRIDE;
            const code = MODE_CODES[newMode];
            this.profileBuf[base + P_MODE] = code;
            this.profileComputers[DEFAULTS_PROFILE] = this.computerForMode(code);
        }

        // Smoothing-mode fields → profile 0 (slots sharing it follow).
        const s = opts as SmoothingOptions;
        const base = DEFAULTS_PROFILE * PROFILE_STRIDE;
        const p = this.profileBuf;
        if (s.delay !== undefined) p[base + P_DELAY] = s.delay;
        if (s.damping !== undefined) p[base + P_DAMPING] = s.damping;
        if (s.maxExtrapolate !== undefined) p[base + P_MAX_EXTRAPOLATE] = s.maxExtrapolate;
        if (s.tickInterval !== undefined) p[base + P_TICK_INTERVAL] = s.tickInterval;
        if (s.snap !== undefined) { p[base + P_SNAP] = s.snap; this.reckonDefaults.snap = s.snap; }

        // Reckon-mode fields → reckonDefaults.
        const r = opts as ReckonOptions;
        if (r.step !== undefined) this.reckonDefaults.step = r.step;
        if (r.smoothing !== undefined) this.reckonDefaults.smoothing = r.smoothing;
        if (r.substep !== undefined) this.reckonDefaults.substep = r.substep;
    }

    /**
     * Snapshot every profile currently registered with this Predict. Profiles
     * include the defaults (id 0) plus one per unique `(mode, opts)` tuple that's
     * been frozen by per-field attach overrides. Returns engine state only — the
     * profile → field-names mapping the panel shows is derived by the debug
     * bridge from the `onTrack` stream, not here.
     */
    private snapshotProfiles(): ProfileCore[] {
        const out: ProfileCore[] = [];
        for (let i = 0; i < this.profileCount; i++) {
            const base = i * PROFILE_STRIDE;
            const m = this.profileBuf[base + P_MODE] | 0;
            if (m === MODE_BOUND) continue;   // controller-owned — nothing tunable

            const mode: PredictMode =
                m === MODE_LERP ? "lerp" :
                m === MODE_EXTRAPOLATE ? "extrapolate" :
                m === MODE_DAMPED ? "damped" :
                m === MODE_RECKON ? "reckon" : "raw";
            out.push({
                id: i,
                isDefault: i === DEFAULTS_PROFILE,
                label: this.profileLabels[i],
                mode,
                delay: this.profileBuf[base + P_DELAY],
                damping: this.profileBuf[base + P_DAMPING],
                maxExtrapolate: this.profileBuf[base + P_MAX_EXTRAPOLATE],
                tickInterval: this.profileBuf[base + P_TICK_INTERVAL],
                snap: this.profileBuf[base + P_SNAP],
            });
        }
        return out;
    }

    /**
     * Mutate one profile in place. Used by the debug panel's per-profile
     * controls. Setting `mode` swaps the cached `profileComputers[id]` in
     * lock-step so slot reads pick the new dispatch immediately.
     */
    private setProfile(id: number, opts: { mode?: PredictMode } & SmoothingOptions): void {
        if (id < 0 || id >= this.profileCount) return;
        const base = id * PROFILE_STRIDE;
        const p = this.profileBuf;
        if ((p[base + P_MODE] | 0) === MODE_BOUND) return;   // controller-owned — not tunable
        if (opts.mode !== undefined) {
            const code = MODE_CODES[opts.mode];
            p[base + P_MODE] = code;
            this.profileComputers[id] = this.computerForMode(code);
            // Defaults profile's mode also drives the outer routing's
            // smoothing-mode encoding, keep them aligned.
            if (id === DEFAULTS_PROFILE) this.defaultMode = opts.mode;
        }
        if (opts.delay !== undefined) p[base + P_DELAY] = opts.delay;
        if (opts.damping !== undefined) p[base + P_DAMPING] = opts.damping;
        if (opts.maxExtrapolate !== undefined) p[base + P_MAX_EXTRAPOLATE] = opts.maxExtrapolate;
        if (opts.tickInterval !== undefined) p[base + P_TICK_INTERVAL] = opts.tickInterval;
        if (opts.snap !== undefined) p[base + P_SNAP] = opts.snap;
    }

    /**
     * Tear down all subscriptions. Detaches every attached instance, frees
     * smoothing slots, removes the Predict from the debug registry, and
     * invokes onDispose listeners.
     */
    dispose(): void {
        for (const refId of new Set([...this.slotByRef.keys(), ...this.simByRef.keys()])) this.detachByRef(refId);
        this.trackListeners.length = 0;
        for (const d of this.driven.splice(0)) (d as { dispose?(): void }).dispose?.();
        for (const cb of this.disposeListeners.splice(0)) cb();
    }


    // --- Low-level smoothing primitives ----------------------------------------

    /**
     * @internal Low-level primitive — track one numeric field for smoothing.
     * Most consumers should use {@link attach} / {@link attachAll}; this is
     * the underlying mechanism the high-level paths build on, exposed for
     * advanced per-field control or when integrating with frameworks that
     * already manage their own attach lifecycle.
     */
    track<T extends object>(
        instance: T,
        field: NumericKeys<T>,
        opts: SmoothingOptions = {},
    ): () => void {
        // Resolve to a shared profile (empty opts → defaults profile;
        // non-empty → frozen, value-deduped). The mode encoded in the
        // profile drives dispatch — including reckon and raw — so this
        // primitive accepts any `PredictMode` in `opts.mode`.
        return this.trackWithProfile(instance, field, this.profileFromOpts(opts), opts.angle ?? false);
    }

    /**
     * @internal Track `field` under an explicit, pre-resolved profile. The
     * attach path uses this so a whole group shares ONE labeled profile
     * instead of each field re-resolving (and possibly collapsing onto the
     * mutable default #0). The read/sample hot path is identical either way —
     * the slot just stores whichever profile id it's given.
     */
    private trackWithProfile<T extends object>(
        instance: T,
        field: NumericKeys<T>,
        profileIdx: number,
        angle: boolean = false,
    ): () => void {
        // Resolve the schema-native identity once, here at the API boundary.
        // The hot path (samples + reads) operates purely on these integers.
        const refId = refIdOf(instance);
        if (refId === undefined) {
            throw new Error(
                "Predict.track(): instance has no refId — track/attach must run " +
                "AFTER the decoder delivers the instance (e.g. inside onAdd).",
            );
        }
        const fieldId = fieldIndexOf(instance, field);

        // `field: NumericKeys<T>` guarantees `instance[field]` is `number`;
        // the `?? 0` only covers the case where the schema field hasn't
        // been hydrated by the decoder yet.
        const initial: number = (instance[field] as number) ?? 0;

        // Idempotent per field: re-tracking the SAME field frees + replaces its slot,
        // leaving OTHER fields on the instance untouched — so a 2nd attach()/attachAll()
        // COMPOSES additively instead of leaking the old slot. This is what lets
        // attachWithPlan skip the blanket detach that used to clobber sibling attaches.
        // When the current mapping is a controller overlay (MODE_BOUND), the overlay
        // wins: the new passive slot installs UNDERNEATH it as the stash (replacing
        // any previous understudy) and keeps sampling until the controller disposes.
        let boundOver: BoundSlotEntry | undefined;
        const existingIdx = this.slotByRef.get(refId)?.get(field);
        if (existingIdx !== undefined) {
            boundOver = this.boundBySlot.get(existingIdx);
            if (boundOver !== undefined) this.freeStash(boundOver);
            else this.untrackSlot(refId, field);
        }

        const slotIdx = this.allocSlot();
        const buf = this.slotBuf;
        const base = slotIdx * SLOT_STRIDE;
        buf[base + SLOT_V1] = initial;
        buf[base + SLOT_AUX_V] = initial;
        buf[base + SLOT_AUX_T] = performance.now();
        buf[base + SLOT_PROFILE] = profileIdx;
        buf[base + SLOT_REF] = refId;
        buf[base + SLOT_FIELD] = fieldId;
        // Reset the snapshot ring. Slot reuse via the free-list means stale
        // ring state could survive across attach lifetimes — head=count=0
        // makes the ring logically empty (entry floats are masked by count).
        buf[base + SLOT_RING_HEAD] = 0;
        buf[base + SLOT_RING_COUNT] = 0;
        this.slotAngle[slotIdx] = angle;

        if (boundOver !== undefined) {
            boundOver.stash = slotIdx;
        } else {
            let perRef = this.slotByRef.get(refId);
            if (perRef === undefined) { perRef = new Map(); this.slotByRef.set(refId, perRef); }
            perRef.set(field, slotIdx);
        }

        // Notify track listeners (the debug bridge, when present) so it can
        // build its profile → field-names view outside the engine. Empty in
        // prod — this is a length check on the cold attach path.
        for (let li = 0; li < this.trackListeners.length; li++) {
            this.trackListeners[li](profileIdx, field);
        }

        // Sample-update hot path: push to ring + update v1. Capture `slotIdx`
        // by value; `this.slotBuf` is re-read each call to pick up grown
        // buffers transparently.
        const detach = this.callbacks.listen(
            instance,
            field,
            (current: number) => {
                // Server-time axis: stamp samples with the patch's server-encode time
                // (jitter-free, server-stamped) when a clock is present, so interpolation
                // is immune to network arrival jitter. No clock → client arrival (perf.now).
                const now = (this.clock && this.clock.lastServerTime() > 0) ? this.clock.lastServerTime() : performance.now();
                const b = this.slotBuf;
                const i = slotIdx * SLOT_STRIDE;
                // Angle field: fold the new wrapped value onto the last stored (continuous)
                // one over the shortest arc, so the ring stays monotonic across ±π and the
                // interpolators never spin the long way. sin/cos make the delta period-2π.
                if (angle) { const prev = b[i + SLOT_V1]; current = prev + Math.atan2(Math.sin(current - prev), Math.cos(current - prev)); }
                const pBase = (b[i + SLOT_PROFILE] | 0) * PROFILE_STRIDE;
                const tickInterval = this.profileBuf[pBase + P_TICK_INTERVAL];

                let head = b[i + SLOT_RING_HEAD] | 0;
                let count = b[i + SLOT_RING_COUNT] | 0;

                // Value-space discontinuity (`snap` option): a per-sample jump
                // beyond the threshold is a TELEPORT, not motion — empty the
                // ring and snap the damped/extrapolate output state, so every
                // mode renders the new value immediately instead of gliding
                // across the gap. SLOT_V1 still holds the PREVIOUS sample here
                // (mirrored below). The zeroed count also disables the
                // gap-collapse inject for this sample (count >= 2 guard).
                const snapDelta = this.profileBuf[pBase + P_SNAP];
                if (snapDelta > 0 && count > 0 && Math.abs(current - b[i + SLOT_V1]) > snapDelta) {
                    head = 0;
                    count = 0;
                    b[i + SLOT_AUX_V] = current;
                }

                // Derive lastT1 (timestamp of the previous newest snapshot)
                // straight from the ring — no per-slot t1 field needed.
                const lastT1 = count === 0
                    ? Number.NEGATIVE_INFINITY
                    : b[i + SLOT_RING_BASE + (head === 0 ? RING_CAP - 1 : head - 1) * 2];

                // Tick-snap incoming sample times to a regular grid so the
                // snapshot ring's bracketing lookup walks uniformly even when
                // packets arrive with jitter. Skipped for the first sample.
                // Bounded at +1 interval past `now` so the grid can't drift
                // into the future.
                let snapT = now;
                if (tickInterval > 0 && isFinite(lastT1)) {
                    const elapsed = now - lastT1;
                    const ticks = elapsed > 0 ? Math.max(1, Math.round(elapsed / tickInterval)) : 1;
                    snapT = lastT1 + ticks * tickInterval;
                    const cap = now + tickInterval;
                    if (snapT > cap) snapT = cap;
                }

                // Mirror the latest value into SLOT_V1 — damped reads it as
                // its EMA target without having to walk the ring.
                b[i + SLOT_V1] = current;

                // Idle-resume gap collapse. If this sample lands far after the
                // previous one RELATIVE to the recent inter-arrival cadence, the
                // field was idle (delta encoding sent nothing). INJECT a
                // synthetic "held" sample carrying the previous value at
                // `snapT - resumeSpan`, so the stale anchor stays put (the
                // entity reads as held during idle) and motion resumes over one
                // normal interval instead of crawling across the whole gap.
                // Compared against the last *normal* interval (ring[head-2]→
                // ring[head-1]) so a genuinely sparse-but-regular stream
                // (gap ≈ its own cadence) is left untouched.
                const ringBase = i + SLOT_RING_BASE;
                if (count >= 2 && isFinite(lastT1)) {
                    const h1 = head === 0 ? RING_CAP - 1 : head - 1;       // previous newest
                    const h2 = h1 === 0 ? RING_CAP - 1 : h1 - 1;           // one before it
                    const lastInterval = lastT1 - b[ringBase + h2 * 2];
                    // Prefer the server-advertised patch cadence (stable, immune to
                    // the measured interval drifting after a prior collapse); fall
                    // back to MULT × the measured interval when it's unknown.
                    const patchMs = this.clock?.patchInterval ? this.clock.patchInterval() : 0;
                    const span = patchMs > 0 ? patchMs : lastInterval;
                    const trigger = patchMs > 0 ? GAP_RESUME_PATCH_MULT * patchMs : GAP_RESUME_MULT * lastInterval;
                    if (span > 0 && (snapT - lastT1) > trigger) {
                        const resumeSpan = span < GAP_RESUME_MAX_MS ? span : GAP_RESUME_MAX_MS;
                        const sOff = ringBase + head * 2;
                        b[sOff] = snapT - resumeSpan;
                        b[sOff + 1] = b[ringBase + h1 * 2 + 1]; // previous (held) value
                        head = head + 1 >= RING_CAP ? 0 : head + 1;
                        if (count < RING_CAP) count++;
                    }
                }

                // Push onto the snapshot ring. Head wraps at RING_CAP, count
                // saturates — past capacity, new writes overwrite the oldest
                // entry in place (no shift, no allocation).
                const off = ringBase + head * 2;
                b[off] = snapT;
                b[off + 1] = current;
                b[i + SLOT_RING_HEAD] = head + 1 >= RING_CAP ? 0 : head + 1;
                if (count < RING_CAP) b[i + SLOT_RING_COUNT] = count + 1;
            },
            /* immediate */ true,
        );
        this.slotDetach[slotIdx] = detach;

        return () => this.untrackSlot(refId, field);
    }

    /**
     * @internal Counterpart to {@link track}. Most consumers should use
     * {@link detach} / {@link attachAll}'s onRemove subscription instead.
     */
    untrack<T extends object>(instance: T, field: NumericKeys<T>): void {
        const refId = refIdOf(instance);
        if (refId === undefined) return;
        this.untrackSlot(refId, field);
    }

    private untrackSlot(refId: number, field: string): void {
        const perRef = this.slotByRef.get(refId);
        const slotIdx = perRef?.get(field);
        if (slotIdx === undefined) return;
        const bound = this.boundBySlot.get(slotIdx);
        if (bound !== undefined) {
            // The mapping is a controller overlay: untrack removes the PASSIVE
            // registration underneath (the stash). The overlay itself is torn
            // down only by its controller's dispose (or by detachByRef when the
            // entity itself is removed).
            this.freeStash(bound);
            return;
        }
        this.slotDetach[slotIdx]?.();
        this.slotDetach[slotIdx] = undefined;
        this.freeSlots.push(slotIdx);
        perRef!.delete(field);
        if (perRef!.size === 0) this.slotByRef.delete(refId);
    }

    /** Free a bound entry's stashed passive slot (detach its listener). */
    private freeStash(entry: BoundSlotEntry): void {
        if (entry.stash < 0) return;
        this.slotDetach[entry.stash]?.();
        this.slotDetach[entry.stash] = undefined;
        this.freeSlots.push(entry.stash);
        entry.stash = -1;
    }

    private allocSlot(): number {
        if (this.freeSlots.length > 0) return this.freeSlots.pop()!;
        const idx = this.slotCount++;
        const needed = (idx + 1) * SLOT_STRIDE;
        if (needed > this.slotBuf.length) {
            const grown = new Float64Array(this.slotBuf.length * 2);
            grown.set(this.slotBuf);
            this.slotBuf = grown;
        }
        return idx;
    }

    // --- Bound overlay (predict.value ← rollback controllers) -------------------

    /**
     * Install a MODE_BOUND overlay slot for each (source, numeric field) a
     * rollback controller predicts, so `predict.value(source, field)` reads the
     * controller's interpolated + smooth-corrected pose — the same idiom as
     * every passively-smoothed entity. A pre-existing passive slot (e.g. the
     * local player inside an `attachAll` lerp group) is STASHED — its field
     * listener stays subscribed and samples keep landing in its ring — and
     * restored when the controller disposes, so lerp resumes seamlessly.
     *
     * Returns the unregister (run on the controller's dispose): frees the
     * overlay slots and restores (or deletes) each mapping.
     */
    private registerBound(
        ctrl: { value(field: string): number },
        source: object,
        fields: readonly string[],
        poseKeys: readonly string[],
        profileIdx: number,
    ): () => void {
        const refId = refIdOf(source)!;   // callers pre-check (bound sources are decoded)
        let perRef = this.slotByRef.get(refId);
        if (perRef === undefined) { perRef = new Map(); this.slotByRef.set(refId, perRef); }
        const slots: number[] = [];
        for (let k = 0; k < fields.length; k++) {
            const field = fields[k];
            const existing = perRef.get(field);
            let stash = -1;
            if (existing !== undefined) {
                const prior = this.boundBySlot.get(existing);
                if (prior !== undefined) {
                    // Same (instance, field) claimed twice (two controllers, or one
                    // instance in two world parts): last registration wins — mirrors
                    // the "one accumulator can't pace two rates" posture. The
                    // ORIGINAL passive stash is inherited by the winner.
                    console.warn(
                        `@colyseus/sdk Predict: "${field}" (refId ${refId}) is already bound ` +
                        "to a controller — the newer registration wins.",
                    );
                    stash = prior.stash;
                    this.boundBySlot.delete(existing);
                    this.freeSlots.push(existing);
                } else {
                    stash = existing;   // passive slot: stashed, its listener keeps sampling
                }
            }
            const slotIdx = this.allocSlot();
            const buf = this.slotBuf;
            const base = slotIdx * SLOT_STRIDE;
            // Self-describing like any slot, but NO listener — the computer reads
            // the controller, not the sample ring (slotDetach stays undefined;
            // teardown paths use `?.()`).
            const initial = (source as Record<string, number>)[field] ?? 0;
            buf[base + SLOT_V1] = initial;
            buf[base + SLOT_AUX_V] = initial;
            buf[base + SLOT_AUX_T] = 0;
            buf[base + SLOT_PROFILE] = profileIdx;
            buf[base + SLOT_REF] = refId;
            buf[base + SLOT_FIELD] = fieldIndexOf(source, field);
            buf[base + SLOT_RING_HEAD] = 0;
            buf[base + SLOT_RING_COUNT] = 0;
            this.slotAngle[slotIdx] = false;
            this.boundBySlot.set(slotIdx, { ctrl, key: poseKeys[k], stash });
            perRef.set(field, slotIdx);
            slots.push(slotIdx);
            for (let li = 0; li < this.trackListeners.length; li++) {
                this.trackListeners[li](profileIdx, field);
            }
        }
        return () => {
            for (let k = 0; k < slots.length; k++) {
                const slotIdx = slots[k];
                const entry = this.boundBySlot.get(slotIdx);
                // Identity check, not just presence: a freed slot index is recycled
                // by the free-list, so after a duplicate-claim (or entity removal)
                // this index may now back ANOTHER controller's overlay — which this
                // stale unregister must not tear down.
                if (entry === undefined || entry.ctrl !== ctrl) continue;
                this.boundBySlot.delete(slotIdx);
                this.freeSlots.push(slotIdx);
                const pr = this.slotByRef.get(refId);
                if (pr?.get(fields[k]) === slotIdx) {
                    if (entry.stash >= 0) {
                        pr.set(fields[k], entry.stash);   // resume the passive slot
                    } else {
                        pr.delete(fields[k]);
                        if (pr.size === 0) this.slotByRef.delete(refId);
                    }
                }
            }
        };
    }

    /** Wire a just-spawned controller's bound instances into the `value()`
     *  overlay (all controllers share the one MODE_BOUND profile — the side
     *  table, not the profile, carries the per-slot backing) and arrange the
     *  restore on its dispose. No-op for controllers with nothing bound (opaque
     *  sim worlds, plain-fixture reconcilers). */
    private installBoundOverlay(ctrl: BoundController): void {
        const offs: Array<() => void> = [];
        for (const reg of ctrl.boundRegistrations) {
            if (reg.fields.length === 0 || refIdOf(reg.source) === undefined) continue;
            if (this.boundProfileIdx < 0) {
                this.boundProfileIdx = this.allocProfile(MODE_BOUND, 0, 0, 0, 0, 0, false, "bound");
            }
            offs.push(this.registerBound(ctrl, reg.source, reg.fields, reg.poseKeys, this.boundProfileIdx));
        }
        if (offs.length > 0) ctrl.onDisposed(() => { for (const off of offs) off(); });
    }

    /**
     * @internal Low-level dead-reckoning primitive — forward-simulates
     * `instance` using a step function with scratch-snapshot + substep loop +
     * predict-then-smooth on read. Most consumers should pass a reckon
     * attach config to {@link attach} / {@link attachAll}; this is the
     * underlying implementation, exposed for cases where the declarative
     * config shape doesn't fit.
     */
    trackStepped<T extends object>(instance: T, opts: SteppedOptions<T>): () => void {
        const substep = opts.substep ?? 16;
        const fields = opts.fields;
        const fieldIds = fields.map((f) => fieldIndexOf(instance, f as string));
        const step = opts.step;
        const clock = this.clock;

        // Default forward horizon = SNAPSHOT AGE, exactly.
        //
        // Age = `serverNow() − lastServerTime()` (current server time minus the
        // server-encode time of the latest patch) — the exact amount to forward
        // a remote entity to its CURRENT server position. Unlike a fixed RTT
        // proxy it's the true downstream age (~RTT/2 + buffering, not the full
        // round trip) and GROWS between patches (continuous, not
        // freeze-then-step).
        //
        // No lag compensation on top: offset-decay smoothing is steady-state
        // EXACT (only rebase discontinuities decay), so the displayed instant
        // IS serverNow — which is exactly what the input prefix stamps as
        // reckonTime. Any extra lead here desyncs display from stamp and the
        // server's lag-comp reads mis-aim by lead × velocity (enough to flip
        // knife-edge hit calls). Override `forwardMs` for a different
        // horizon (e.g. a collision read wanting extra look-ahead).
        const smoothing = opts.smoothing ?? 20;
        const present = this.presentFn(); // serverNow(), or renderNow() under renderPresent
        const forwardMs = opts.forwardMs ?? (present
            ? () => { const stamp = clock!.lastServerTime(); return stamp > 0 ? Math.max(0, present() - stamp) : 0; }
            : () => 0);
        const elapsedMs = opts.elapsedMs ?? (present ?? (() => performance.now()));

        // Build `advance` once. It writes predicted fields into the SoA `out`
        // buffer (indexed by field position) — never a name-keyed object.
        const liveValues = (instance as Record<symbol, unknown>)[$VALUES];
        // The SoA fast path is only valid when the instance actually stores its
        // field values in a dense `$values` array indexed by field index. Some
        // @colyseus/schema versions expose values ONLY through prototype getters
        // and leave `$values` empty (length 0) — `Array.isArray([])` is still
        // true, but reading `sv[fieldId]` then yields `undefined`, which a
        // Float64Array coerces to NaN (entity vanishes). Require the array to
        // actually cover every field we read; otherwise fall through to the
        // generic accessor-based snapshot, which reads via the getters.
        const fastPathOk =
            opts.snapshot === undefined &&
            Array.isArray(liveValues) &&
            fieldIds.every((id) => id >= 0 && id < (liveValues as unknown[]).length);
        let advance: (live: T, fwd: number, out: Float64Array, endElapsed: number) => void;
        if (fastPathOk) {
            // SoA fast path (decoded schema instances). The scratch is a pooled
            // instance of the same type; each frame we refill its `$values`
            // array BY INDEX from the live instance (no dynamic-key object
            // building → no V8 dictionary mode, no megamorphic keyed store),
            // let `step` mutate it through its accessors, then extract the
            // predicted fields BY INDEX. Fully monomorphic + zero allocation.
            const scratch = new (instance.constructor as new () => T)();
            const sv = (scratch as Record<symbol, number[]>)[$VALUES];
            advance = (live, fwd, out, endElapsed) => {
                const lv = (live as Record<symbol, number[]>)[$VALUES];
                for (let i = 0; i < lv.length; i++) sv[i] = lv[i];
                let remaining = fwd;
                // The scratch is the SNAPSHOT state (age `fwd` ago), so absolute
                // time runs from `endElapsed − fwd` and the LAST substep lands
                // exactly on `endElapsed` — time-SAMPLED fields (sinusoids,
                // cooldown snaps) then read the same instant the input stamp
                // claims. Starting at `endElapsed` instead would evaluate them
                // `fwd` ms (≈ one-way latency) in the future — a latency-scaled
                // desync the server's lag-comp read can't cancel.
                let elapsed = endElapsed - fwd;
                while (remaining > 0) {
                    const stepMs = remaining < substep ? remaining : substep;
                    elapsed += stepMs;
                    // elapsed at the END of the substep: equivalent for
                    // integrated quantities, correct for time-sampled ones.
                    step(scratch, stepMs / 1000, elapsed);
                    remaining -= stepMs;
                }
                for (let k = 0; k < fieldIds.length; k++) out[k] = sv[fieldIds[k]];
            };
        } else {
            // Generic path: non-schema instance, a caller-supplied snapshot, or
            // (the common browser case) a decoded instance whose `$values` SoA is
            // empty so the fast path above didn't apply. Builds a fresh named
            // scratch each frame and extracts by name. When metadata is available
            // the per-field copy is UNROLLED (monomorphic, no eval — see
            // makeUnrolledSnapshot); otherwise a plain `{...instance}` spread
            // covers non-schema objects.
            const fieldNames = scalarFieldNamesOf(instance);
            const snapshotFn: (e: T) => T = opts.snapshot ?? (fieldNames.length > 0
                ? (makeUnrolledSnapshot(fieldNames) as (e: T) => T)
                : (e: T) => ({ ...e } as T));
            const names = [...fields] as string[];
            advance = (live, fwd, out, endElapsed) => {
                const scratch = snapshotFn(live) as Record<string, unknown>;
                let remaining = fwd;
                // Snapshot-relative absolute time — see the fast path above.
                let elapsed = endElapsed - fwd;
                while (remaining > 0) {
                    const stepMs = remaining < substep ? remaining : substep;
                    elapsed += stepMs;
                    step(scratch as T, stepMs / 1000, elapsed);
                    remaining -= stepMs;
                }
                for (let k = 0; k < names.length; k++) out[k] = scratch[names[k]] as number;
            };
        }

        return this.trackSimulated(instance, {
            fields,
            forwardMs,
            elapsedMs,
            smoothing: opts.smoothing,
            snap: opts.snap,
            advance,
        });
    }

    private trackSimulated<T extends object>(instance: T, opts: SimulateOptions<T>): () => void {
        const refId = refIdOf(instance);
        if (refId === undefined) {
            throw new Error(
                "Predict.trackStepped(): instance has no refId — must run AFTER " +
                "the decoder delivers the instance (e.g. inside onAdd).",
            );
        }
        const fields = opts.fields;
        const n = fields.length;
        const fieldIds = fields.map((f) => fieldIndexOf(instance, f as string));
        let maxId = 0;
        for (const id of fieldIds) if (id > maxId) maxId = id;
        const posOf = new Int8Array(maxId + 1).fill(-1);
        for (let k = 0; k < n; k++) if (fieldIds[k] >= 0) posOf[fieldIds[k]] = k;
        const smoothed = new Float64Array(n);
        for (let k = 0; k < n; k++) smoothed[k] = (instance as any)[fields[k]] ?? 0;
        // Default the absolute-time provider to the reckon present — serverNow,
        // or renderNow under renderPresent (matches the per-frame reckon).
        // `valueAt` overrides the end instant per call, so hit reads stay exact.
        const present = this.presentFn();
        const elapsedMs = opts.elapsedMs ?? (present ?? (() => performance.now()));
        const state: SimState = {
            instance,
            fieldIds,
            posOf,
            forwardMs: opts.forwardMs,
            elapsedMs,
            advance: opts.advance as SimState["advance"],
            smoothing: opts.smoothing ?? 20,
            snap: opts.snap ?? 0,
            smoothed,
            out: new Float64Array(n),
            valueOut: new Float64Array(n),
            offset: new Float64Array(n),
            outPrev: new Float64Array(n),
            frameVel: new Float64Array(n),
            lastBaseT: NaN,
            lastApplyTime: -Infinity,
        };
        this.simByRef.set(refId, state);
        return () => this.untrackSimulated(refId);
    }

    private untrackSimulated(refId: number): void {
        this.simByRef.delete(refId);
    }

    // --- High-level orchestration ----------------------------------------------

    /**
     * Attach prediction to a single schema instance via a declarative config.
     *
     * For collections, prefer {@link attachAll}. For a root-level instance
     * that arrives lazily, wrap this call in
     * `Callbacks.get(room).listen(state, "field", ..., true)`.
     */
    attach<T extends object>(instance: T, config: AttachConfig<T>): () => void {
        // A standalone attach is its own one-off group, labeled "(attach)".
        // Identical configs dedup under that label (so a hand-rolled loop over
        // many instances doesn't explode the profile table); for per-collection
        // isolation use attachAll, which labels the group by its key.
        const group = this.makeGroup("(attach)", config);
        return this.attachWithPlan(instance, this.planFor(group, instance));
    }

    /** One group per attach()/attachAll(): base plan built eagerly (so config
     *  errors throw at the call site, like before); per-type sub-plans lazy. */
    private makeGroup(label: string, config: AttachConfig<any>): AttachGroup {
        return {
            label,
            config,
            basePlan: this.buildGroupPlan(config, label),
            planByCtor: new Map(),
        };
    }

    /** The plan for one child — the group's base plan unless the child's TYPE
     *  lacks some of the configured fields (those are dropped). Cached per
     *  constructor: homogeneous collections hit one entry. */
    private planFor(group: AttachGroup, child: object): GroupPlan {
        const ctor = child.constructor as Function;
        let plan = group.planByCtor.get(ctor);
        if (plan === undefined) {
            plan = this.resolveCtorPlan(group, child);
            group.planByCtor.set(ctor, plan);
        }
        return plan;
    }

    /**
     * Once per (group, constructor): drop fields the child type doesn't declare
     * (they'd subscribe to nothing and, in reckon scratch, read garbage). Mode
     * is the group's — the client's prediction mode is explicit, never inferred
     * from the schema. Returns the base plan when every field is present;
     * otherwise builds a `label:TypeName` sub-plan with its own profile.
     */
    private resolveCtorPlan(group: AttachGroup, child: object): GroupPlan {
        const md = metadataOf(child);
        const typeName = (child.constructor as Function | undefined)?.name || "?";
        const config = group.config;

        if (!isReckonAttachConfig(config)) {
            // Per-field smoothing map.
            if (md === undefined) return group.basePlan;   // non-schema fixture
            const keys = Object.keys(config).filter((k) => (config as Record<string, unknown>)[k] !== undefined);
            if (keys.every((k) => typeof md[k] === "number")) return group.basePlan;
            const filtered: Record<string, unknown> = {};
            for (const k of keys) if (typeof md[k] === "number") filtered[k] = (config as Record<string, unknown>)[k];
            return this.buildGroupPlan(filtered as AttachConfig<any>, `${group.label}:${typeName}`);
        }

        const rcfg = config as ReckonAttachConfig<any>;
        let fields = rcfg.fields as readonly string[];
        if (md !== undefined) {
            const filtered = fields.filter((f) => typeof md[f] === "number");
            if (filtered.length !== fields.length) fields = filtered;
        }
        if (fields === rcfg.fields) return group.basePlan;   // all fields present
        return this.buildGroupPlan({ ...rcfg, fields } as AttachConfig<any>, `${group.label}:${typeName}`);
    }

    /**
     * Resolve a group's profiles ONCE. Profiles are allocated via
     * {@link groupProfile} (labeled, never the mutable default #0), so every
     * child of the group shares the group's own profile and the panel can tune
     * it without bleeding into other groups.
     */
    private buildGroupPlan<T extends object>(config: AttachConfig<T>, label: string): GroupPlan {
        const fieldProfiles: Array<{ field: string; profileIdx: number; angle?: boolean }> = [];
        if (isReckonAttachConfig(config)) {
            const rcfg = config as ReckonAttachConfig<T>;
            if (!Array.isArray(rcfg.fields)) {
                throw new Error("Predict.attach(): `fields` must be a numeric-key array.");
            }
            const effectiveMode: PredictMode = rcfg.mode ?? this.defaultMode;
            const step = rcfg.step ?? this.reckonDefaults.step;
            const isReckon = effectiveMode === "reckon";
            if (isReckon && typeof step !== "function") {
                throw new Error(
                    "Predict.attach(): reckon mode requires a 'step' function. " +
                    "Either pass `step` in the attach config OR construct the Predict with " +
                    "`Predict.get(room, { mode: 'reckon', step: yourStepFn })` so it can be inherited.",
                );
            }
            // One profile for the whole group (all fields share it).
            const profileIdx = this.groupProfile({ mode: effectiveMode, snap: rcfg.snap }, label);
            for (const f of rcfg.fields) fieldProfiles.push({ field: f as string, profileIdx, angle: rcfg.angle });
            return {
                label,
                isReckon,
                reckonFields: isReckon ? (rcfg.fields as readonly string[]) : undefined,
                reckonStep: isReckon ? step : undefined,
                reckonSmoothing: rcfg.smoothing ?? this.reckonDefaults.smoothing,
                reckonSubstep: rcfg.substep ?? this.reckonDefaults.substep,
                reckonSnap: rcfg.snap ?? this.reckonDefaults.snap,
                reckonSnapshot: rcfg.snapshot,
                fieldProfiles,
            };
        }
        // Smoothing-only per-field map. Each field gets a profile (deduped
        // within the group by params), so `{ x:"lerp", vx:"extrapolate" }`
        // yields two group-labeled profiles → two panel sub-cards.
        const smoothing = config as SmoothingConfig<T>;
        for (const key of Object.keys(smoothing) as unknown as ReadonlyArray<NumericKeys<T>>) {
            const value = smoothing[key];
            if (value === undefined) continue;
            const o: SmoothingOptions = typeof value === "string" ? { mode: value } : value;
            fieldProfiles.push({ field: key as string, profileIdx: this.groupProfile(o, label), angle: o.angle });
        }
        return { label, isReckon: false, fieldProfiles };
    }

    /** Attach one child using a pre-resolved {@link GroupPlan}. `forwardMs`
     *  overrides the reckon horizon for THIS instance only (e.g. the spawns
     *  store's per-entity input lead); omitted → snapshot age, as usual. */
    private attachToGroup<T extends object>(instance: T, plan: GroupPlan, forwardMs?: () => number): () => void {
        const offs: Array<() => void> = [];
        if (plan.isReckon) {
            offs.push(this.trackStepped<T>(instance, {
                fields: plan.reckonFields as readonly (keyof T & string)[],
                step: plan.reckonStep as (s: T, dt: number, e: number) => void,
                smoothing: plan.reckonSmoothing,
                substep: plan.reckonSubstep,
                snap: plan.reckonSnap,
                snapshot: plan.reckonSnapshot as ((s: T) => T) | undefined,
                forwardMs,
            }));
        }
        for (const { field, profileIdx, angle } of plan.fieldProfiles) {
            offs.push(this.trackWithProfile(instance, field as NumericKeys<T>, profileIdx, !!angle));
        }
        return () => { for (const f of offs) f(); };
    }

    private attachWithPlan<T extends object>(instance: T, plan: GroupPlan): () => void {
        const refId = refIdOf(instance);
        if (refId === undefined) {
            throw new Error(
                "Predict.attach(): instance has no refId — attach must run AFTER " +
                "the decoder delivers the instance (e.g. inside onAdd).",
            );
        }
        // No blanket detach: attachToGroup tracks each field idempotently (see
        // trackWithProfile), so this ADDS to whatever is already tracked on the
        // instance — a 2nd attachAll for other fields composes instead of clobbering.
        this.attachToGroup(instance, plan);
        return () => this.detachByRef(refId);
    }

    /** Detach a previously {@link attach}'d instance. No-op if not attached. */
    detach(instance: object): void {
        const refId = refIdOf(instance);
        if (refId !== undefined) this.detachByRef(refId);
    }

    private detachByRef(refId: number): void {
        // Data-driven teardown — no stored closures. slotByRef already maps the
        // instance to every field tracked on it (across however many attach calls),
        // so walk it and free each slot, then drop any reckon SimState. Snapshot the
        // keys: untrackSlot mutates perRef (and deletes the slotByRef entry when empty).
        const perRef = this.slotByRef.get(refId);
        if (perRef) {
            for (const field of [...perRef.keys()]) {
                const slotIdx = perRef.get(field);
                if (slotIdx === undefined) continue;
                const bound = this.boundBySlot.get(slotIdx);
                if (bound !== undefined) {
                    // The ENTITY died while a controller overlay was live: tear down
                    // the overlay AND its stash — a recycled refId must not collide
                    // with a stale mapping. The controller's own dispose then finds
                    // the side entry gone and skips (its logic reads keep working
                    // off `me.world` until it's disposed).
                    this.freeStash(bound);
                    this.boundBySlot.delete(slotIdx);
                    this.freeSlots.push(slotIdx);
                    perRef.delete(field);
                } else {
                    this.untrackSlot(refId, field);
                }
            }
            if (perRef.size === 0) this.slotByRef.delete(refId);
        }
        this.simByRef.delete(refId);
    }

    /**
     * Attach prediction to every child of a collection on the root state.
     * Mirrors `callbacks.onAdd("enemies", cb)`'s shape — when the collection
     * lives on `room.state` you can omit the parent.
     */
    attachAll<K extends CollectionKeys<TState>>(
        key: K,
        config: AttachConfig<ChildOf<TState[K]>>,
    ): () => void;
    /**
     * Attach prediction to every child of a nested collection at `parent[key]`.
     * Wires `onAdd` to {@link attach} the child and `onRemove` to detach it.
     * Works for MapSchema / ArraySchema / SetSchema.
     *
     * @returns A detacher that unsubscribes add/remove AND detaches every
     *   child still tracked.
     */
    attachAll<P extends object, K extends CollectionKeys<P>>(
        parent: P,
        key: K,
        config: AttachConfig<ChildOf<P[K]>>,
    ): () => void;
    attachAll(...args: any[]): () => void {
        // Mirror Callbacks: `typeof args[0] === 'string'` ⇒ root variant.
        const rootForm = typeof args[0] === "string";
        const parent: object | undefined = rootForm ? undefined : args[0];
        const key: string = rootForm ? args[0] : args[1];
        const config: AttachConfig<any> = rootForm ? args[1] : args[2];

        // Resolve the group's base profile(s) ONCE — labeled by the collection
        // key so this group owns its profile and the panel tunes it in
        // isolation. Each child resolves through planFor: homogeneous
        // collections reuse the base plan; a type whose field set differs
        // (missing some configured fields) gets its own per-type sub-plan.
        const group = this.makeGroup(key, config);

        const tracked = new Set<object>();
        const onAdd = (child: object) => {
            this.attachWithPlan(child, this.planFor(group, child));
            tracked.add(child);
        };
        const onRemove = (child: object) => {
            tracked.delete(child);
            this.detach(child);
        };
        const addOff = rootForm
            ? this.callbacks.onAdd(key, onAdd)
            : this.callbacks.onAdd(parent, key, onAdd);
        const removeOff = rootForm
            ? this.callbacks.onRemove(key, onRemove)
            : this.callbacks.onRemove(parent, key, onRemove);
        return () => {
            addOff?.();
            removeOff?.();
            for (const child of tracked) this.detach(child);
            tracked.clear();
        };
    }

    // --- Per-frame driver ------------------------------------------------------

    /**
     * Call once per render frame — the single per-frame driver for the whole
     * prediction stack. Returns your SEND BUDGET: how many fixed input steps are
     * due this frame — mutate + send exactly that many inputs through your input
     * handle (`for (n) { input.data.x = …; input.send(); }`), and the reconcilers
     * observe + predict each send. Besides pacing, the call reconciles + steps +
     * decays every {@link reconciler}/{@link sim} spawned here, advances
     * smoothing, and prunes every {@link events} store.
     *
     * Returns 0 while the fixed step is UNKNOWN: the rate is adopted from the
     * first {@link reconciler}/{@link sim} spawned here, so pre-spawn frames —
     * and passive smoothing-only Predicts — pace nothing. That is the send loop
     * self-gating before the local player exists, not an error; keep calling
     * `tick()` and the budget starts flowing the frame the controller spawns.
     *
     * ORDER WITHIN THE FRAME MATTERS: send the returned steps FIRST, then read
     * render values (`value()`/`pose()`). A read between this call and the frame's
     * sends is one fixed step stale — the interpolation clamps at the latest
     * applied step (never extrapolates), so late frames flat-top and fast objects
     * visibly stutter. The reconciler warns once when it detects that pattern.
     * Game logic that wants the exact predicted state (hit-reg, zone checks)
     * should read `.state`/`.world` instead, which this ordering doesn't affect.
     * In engines that run per-object update callbacks (rather than one frame
     * function), tick AND pump in the earliest registered callback — the frame
     * driver owns input; objects only read. `room.input()` returns the same
     * handle everywhere, so the driver and the entity that predicts through it
     * don't need to share plumbing.
     *
     * `now` defaults to `performance.now()`. When you drive from
     * `requestAnimationFrame`, pass ITS timestamp argument — not `performance.now()`
     * (or `room.clock.now()`) sampled inside the callback: the rAF timestamp is
     * vsync-aligned and evenly spaced, whereas an in-callback reading folds JS
     * scheduling jitter into the frame `dt`, which makes render interpolation advance
     * unevenly (motion looks "not smooth" though it never stutters). Pass it
     * explicitly, too, when ticking multiple Predicts in one frame so they share one
     * frame-time reference.
     */
    tick(now: number = performance.now()): number {
        this.renderTime = now;

        // Advance the room-wide fixed-step accumulator: elapsed render time → the
        // whole number of fixed input steps due this frame (returned to the caller).
        let steps = 0;
        const stepMs = this.fixedStepMs;
        if (stepMs !== undefined && stepMs > 0) {
            const dt = this.lastFrameNow < 0 ? 0 : now - this.lastFrameNow;
            this.stepAcc += dt;
            steps = Math.floor(this.stepAcc / stepMs);
            if (steps > Predict.MAX_STEPS_PER_FRAME) {
                this.stepAcc = 0;   // hitch: emit a bounded count, drop the backlog
                steps = Predict.MAX_STEPS_PER_FRAME;
            } else {
                this.stepAcc -= steps * stepMs;
            }
        }
        this.lastFrameNow = now;

        // Drive children (reconcile + decay); each derives its own render
        // interpolation from `now`. Compact out any disposed ones in the same pass.
        const driven = this.driven;
        let live = 0;
        for (let i = 0; i < driven.length; i++) {
            const d = driven[i];
            if (d.dead) continue;
            d.tick?.(now);
            d.prune?.();
            if (live !== i) driven[live] = d;
            live++;
        }
        if (live !== driven.length) driven.length = live;

        return steps;
    }

    // --- Sibling-store factory -------------------------------------------------

    /**
     * Spawn a raw {@link PredictedEvents} store bound to this Predict's clock —
     * the low-level, FLAG-SHAPED sibling of {@link defineEvent}.
     *
     * Pick by consumption shape:
     *   - **{@link defineEvent}** — callback-shaped: "a discrete thing
     *     happened → fire feedback once → settle" (a goal, a kill sound).
     *     Typed payloads, replay-safe `ctx.predict`, ack-anchored auto-settle.
     *   - **`events()`** — flag-shaped: a queryable set of optimistic FACTS
     *     that render/logic POLL and derive from each frame, OR'd with
     *     authoritative state (`!enemy.alive || deaths.has(id)`). No
     *     callbacks; mispredicts recover implicitly when the entry prunes and
     *     the derived view snaps back. Per-entry handles (cancel/accept) and
     *     arbitrary key types.
     *
     * Equivalent to `PredictedEvents.get(room, opts)` but reuses the cached
     * clock; for applications without a Predict, use `PredictedEvents.get`
     * directly. The returned store is auto-pruned by this Predict's
     * {@link tick} each frame — no separate `prune()` call needed.
     */
    events<K = string>(opts: PredictedEventsGetOptions<K> = {}): PredictedEvents<K> {
        const store = PredictedEvents.get<K>({ clock: this.clock }, opts);
        this.driven.push(store as { prune?(): void });
        return store;
    }

    /**
     * Declare a typed optimistic-event CHANNEL — one logical event type
     * (a goal, a kill, a pickup) owned end-to-end: predicted from the sim
     * (`ctx.predict(channel, payload)` inside a reconciler `step`, replay-safe
     * by construction) or from UI (`channel.predict(payload)`), optimistic
     * feedback via `onPredict`, and settlement against the server:
     * `channel.confirm()` on the authoritative signal, or auto-reject once
     * the server has processed past the prediction without confirming (see
     * the channel header's SETTLEMENT notes).
     *
     * The channel OBJECT is the identity — no string key; call sites hold the
     * binding. Auto-driven by this Predict's {@link tick} — no manual
     * `prune()`.
     *
     *     const goals = predict.defineEvent<Team>({
     *         onPredict: (team) => { celebrate(team); hidePuck(); },
     *         onReject:  ()     => showPuck(),
     *     });
     *     // in the reconciler step:      if (crossed) ctx.predict(goals, team);
     *     // on the server's broadcast:   room.onMessage("score", () => goals.confirm());
     *
     * For unkeyed/low-level needs (string-keyed store, per-entry handles) use
     * {@link events} instead — this channel delegates its settlement timing to
     * the same machinery.
     */
    defineEvent<T>(opts: PredictedEventChannelOptions<T>): PredictedEventChannel<T> {
        const channel = new PredictedEventChannel<T>(opts, this.clock ?? null);
        this.driven.push(channel);
        return channel;
    }

    /**
     * Spawn a {@link PredictedSpawns} store for a collection of optimistically-
     * spawned entities (bullets, grenades, dropped items) at `state[key]`.
     *
     * Predicted locals (added via the store's `spawn(...)`) render instantly;
     * when the authoritative entity arrives in the collection it's correlated
     * to the matching prediction and the two collapse onto one logical entry
     * with a stable `id`. Wires the collection's `onAdd`/`onRemove` and is
     * auto-ticked + pruned by this Predict's {@link tick} — no separate drive.
     *
     * With `fields`, the store also owns the collection's **motion** (no
     * separate `attachAll` needed): confirmed entities are dead-reckoned with
     * the same `step` that advances pending locals, and `store.value(entry,
     * field)` is one read path across the whole life of the entity. Foreign
     * entities reckon to server-present; with `spawnTime`, owned ones reckon
     * to server-present *plus the measured input lead*, so the authoritative
     * entity continues the prediction's flight on the shooter's timeline —
     * no snap-back at the handoff, and the rendered trajectory is the one a
     * favor-the-shooter lag-comp hit test actually judges.
     *
     * The server element type `S` is inferred from `key`; the predicted-local
     * shape defaults to `Partial<S>`, so `spawn()` is type-checked against the
     * server fields with no annotations. To carry client-only fields, annotate
     * a callback param (e.g. `step: (b: { x: number; speed: number }, dt) => …`)
     * and `L` is inferred from it. An optional `data` factory gives each entry
     * an auto-cleaned render-scratch slot (`entry.data: D`), inferred from its
     * return.
     *
     * ```ts
     * const rockets = predict.spawns("rockets", {
     *   owned:     r => r.owner === room.sessionId,      // r: Rocket
     *   spawnTime: r => r.bornMs,                        // exact per-shot lead
     *   step:      stepRocket,                           // shared client/server sim
     *   fields:    ["x", "z"],                           // reckon confirmed entities
     * });
     * // on the predicted fire (live input step):
     * rockets.spawn({ x, z, heading });
     * // render — one path, handoff-invisible, keyed on the stable entry id:
     * for (const e of rockets.entries()) {
     *   draw(e.id, rockets.value(e, "x"), rockets.value(e, "z"));
     * }
     * ```
     */
    spawns<K extends CollectionKeys<TState>, L = Partial<ChildOf<TState[K]>>, D = undefined>(
        key: K,
        opts: PredictSpawnsOptions<ChildOf<TState[K]>, L, D> = {},
    ): PredictedSpawns<ChildOf<TState[K]>, L, D> {
        type S = ChildOf<TState[K]>;
        const store = new PredictedSpawns<S, L, D>(opts, this.clock ?? null);

        // Reckon wiring (`fields` + `step`): every confirmed entity gets a
        // regular reckon attach (group-labeled by the collection key, like
        // attachAll) whose forward horizon is snapshot age plus the entry's
        // measured input lead — 0 for foreign entities (server-present, same
        // as an attachAll reckon), the exact per-spawn uplink for owned ones
        // (see PredictedSpawnsOptions.spawnTime). An owned projectile thus
        // keeps flying the shooter's timeline through the handoff — the view
        // the server's lag-comp rewind judges.
        const fields = opts.fields as readonly NumericKeys<S>[] | undefined;
        const step = opts.step;
        const group = fields !== undefined && step !== undefined
            ? this.makeGroup(String(key), {
                mode: "reckon",
                fields,
                step: step as unknown as (state: S, dt: number, elapsedMs: number) => void,
                smoothing: opts.smoothing ?? 0,
                substep: opts.substep,
            } as ReckonAttachConfig<S>)
            : undefined;
        const untrack = group !== undefined ? new Map<S, () => void>() : undefined;
        const clock = this.clock;

        store.attach((onAdd, onRemove) => {
            const addOff = this.callbacks.onAdd(key, (server: S, k: string | number) => {
                onAdd(server, k);
                if (group === undefined || untrack!.has(server)) return; // decoder re-fire
                const lead = store.entryFor(server)?.leadMs ?? 0;
                const forwardMs = clock
                    ? () => {
                        const stamp = clock.lastServerTime();
                        const age = stamp > 0 ? Math.max(0, clock.serverNow() - stamp) : 0;
                        return Math.max(0, age + lead);
                    }
                    : () => Math.max(0, lead);
                untrack!.set(server, this.attachToGroup(server as object, this.planFor(group, server as object), forwardMs));
            });
            const removeOff = this.callbacks.onRemove(key, (server: S, k: string | number) => {
                untrack?.get(server)?.();
                untrack?.delete(server);
                onRemove(server, k);
            });
            return () => {
                addOff?.(); removeOff?.();
                if (untrack !== undefined) {
                    for (const off of untrack.values()) off();
                    untrack.clear();
                }
            };
        });
        if (group !== undefined) {
            // route store.value() confirmed reads through the reckon slots
            store.bindReader((server, field) => this.value(server as object, field as never));
        }
        this.driven.push(store as { tick?(now: number): void; prune?(): void; dead?: boolean });
        return store;
    }

    /**
     * The canonical interpolation `delay` (the default profile's `delay`, from
     * `Predict.get(room, { delay })` / {@link setDefaults}). Lag compensation's
     * `renderDelay` is bound to this by {@link reconciler}/{@link sim} so the
     * interp buffer the remotes render at and the server's rewind instant are
     * derived from ONE number — they can't drift out of sync.
     */
    private canonicalDelay(): number {
        return this.profileBuf[DEFAULTS_PROFILE * PROFILE_STRIDE + P_DELAY];
    }

    /**
     * Bind lag-comp's `renderDelay` on the input handle to this Predict's lerp
     * `delay` (see {@link InputHandleImpl.bindRenderDelay}) so the remote interp
     * buffer and the server's rewind instant stay one value — no "keep the two
     * delays equal" footgun. `instanceof`-narrowed (not cast), so a non-impl
     * input (a test mock) is a no-op; an explicit `room.input({ renderDelay })`
     * still wins inside `bindRenderDelay`.
     */
    private bindInputRenderDelay(input: InputHandle<any>): void {
        if (input instanceof InputHandleImpl) {
            input.bindRenderDelay(() => this.canonicalDelay());
        }
    }

    /**
     * Spawn a {@link Reconciler} for a locally-controlled entity — server-
     * reconciled rollback (predict your inputs immediately, rewind to the server's
     * authoritative state + replay unacked inputs, smoothly correcting
     * mispredictions). The active counterpart to this Predict's passive modes: use
     * `reconciler()` for the entity you control, lerp/reckon for the rest.
     *
     * A pure OBSERVER of `opts.input` (`room.input(...)`): you mutate + send through
     * the handle (`input.data.x = …; input.send()`) and the reconciler steps each
     * send + reads the server ack (`input.lastProcessed`) off it — the channel you
     * send on is the channel that knows what's acked. `predict.tick(now)` returns
     * how many fixed input steps are due this frame.
     *
     * Auto-ticked by this Predict's {@link tick} each frame (reconcile + smooth-
     * correction decay) — no separate `tick()` call to forget.
     *
     * `opts.fields` defaults to every scalar field of `instance`'s schema — see
     * {@link Reconciler} for the derivation and when to subset explicitly.
     */
    reconciler<S extends object, W>(
        instance: S,
        opts: Omit<ReconcilerOptions<S, Data<W>>, "input"> & { input: InputHandle<W> },
    ): Reconciler<S, Data<W>> {
        // `S` is inferred from `instance`; the wire input type `W` from
        // `opts.input` (the SDK's `InputHandle<W>` — e.g. `room.input<MoveInput>()`).
        // The command type is then `Data<W>` (the input's data fields), so neither
        // type argument needs to be written at the call site, and `step`'s `cmd`
        // is contextually typed.
        // Inject this Predict's clock so ctx.reckonTime resolves its unstamped
        // fallback (serverNow) inside the library; an explicit opts.clock wins.
        const recon = new Reconciler<S, Data<W>>(instance, { ...opts, clock: opts.clock ?? this.clock });
        this.adoptFixedStep(recon.stepMs);
        this.bindInputRenderDelay(opts.input);
        // One read idiom: predict.value(instance, field) reads THIS controller's
        // pose while it's alive (raw fallback before spawn / after dispose).
        this.installBoundOverlay(recon as unknown as BoundController);
        this.driven.push(recon as { tick?(now: number): void; dead?: boolean });
        return recon;
    }

    /**
     * Spawn a {@link SimReconciler} for the entity (or entities) your inputs
     * control — server-reconciled rollback (predict immediately, rewind to the
     * server's authoritative state + replay unacked inputs, smoothly correcting
     * mispredictions) — when their truth isn't a single flat scalar `fields` list:
     * composite scalar state across several schema instances (a paddle + the puck
     * it strikes, reconciled together), or an opaque physics-engine handle. Your
     * `world` owns the state via `step` / `adopt` / `pose` callbacks; the controller
     * runs the rollback loop and passes the world handle to each.
     *
     * Like {@link reconciler}, it OBSERVES `opts.input` (you mutate + send through
     * the handle; `predict.tick(now)` returns the fixed-step count) and is
     * auto-ticked by this Predict's {@link tick} each frame (reconcile + decay).
     */
    sim<W, P extends Record<string, number> = {}, E = any>(
        opts: Omit<SimReconcilerOptions<Data<W>, P, E>, "input"> & { input: InputHandle<W> },
    ): SimReconciler<Data<W>, P, E> {
        // wire input `W` from `opts.input`, pose `P` from `opts.pose` ({} when the
        // world is fully bound and no custom pose exists), world handle `E` from
        // `opts.world` — none written at the call site, and `step`'s `cmd` is
        // contextually typed `Data<W>`.
        // Clock injection: same as reconciler() — resolves ctx.reckonTime's fallback.
        const ctl = new SimReconciler<Data<W>, P, E>({
            ...(opts as SimReconcilerOptions<Data<W>, P, E>),
            clock: opts.clock ?? this.clock,
        });
        this.adoptFixedStep(ctl.stepMs);
        this.bindInputRenderDelay(opts.input);
        // One read idiom: bound world entries register into predict.value(instance,
        // field) — the render layer stops caring which strategy backs an entity.
        this.installBoundOverlay(ctl as unknown as BoundController);
        this.driven.push(ctl as { tick?(now: number): void; dead?: boolean });
        return ctl;
    }

    /**
     * Adopt a spawned reconciler's fixed step as this Predict's room-wide pacing
     * rate (the first one wins — the server has a single tick rate). Warns if a
     * later reconciler advertises a different step, since one accumulator can't
     * pace two rates.
     */
    private adoptFixedStep(stepMs: number): void {
        if (this.fixedStepMs === undefined) {
            this.fixedStepMs = stepMs;
            // Start the count accumulator fresh with the reconciler just created:
            // if this accumulator had been advancing since Predict.get, the first
            // tick after spawn would emit a BURST of steps (all the time elapsed
            // before there was anything to predict), which the app would send at
            // once. (The render clock itself self-corrects any phase offset — see
            // RollbackController.catchUp — so this is about the burst, not smoothness.)
            this.stepAcc = 0;
            this.lastFrameNow = -1;
            return;
        }
        if (Math.abs(this.fixedStepMs - stepMs) > 1e-6) {
            console.warn(
                `@colyseus/sdk Predict: a reconciler's fixed step (${stepMs}ms) differs from ` +
                `this Predict's (${this.fixedStepMs}ms). tick() paces one rate for the whole room; ` +
                `use a separate Predict per rate.`,
            );
        }
    }

    // --- Reads -----------------------------------------------------------------

    /**
     * Smoothed/predicted RENDER value for a numeric field — the one read idiom:
     * passively-smoothed entities (lerp/reckon/…) and instances bound by a
     * live `reconciler()`/`sim()` controller all resolve here (the controller
     * overlays the slot while it lives; dispose restores the passive slot or
     * the raw fallback). Falls through to raw `instance[field]` if the field
     * isn't being tracked — so the read is valid across the entity's whole
     * lifecycle. For game logic on a controlled entity read the controller's
     * `.state`/`.world` instead (exact, no smoothing offset).
     */
    value<T extends object>(instance: T, field: NumericKeys<T>): number {
        // Hot read: refId (one symbol load) + two Map.gets (refId → field name →
        // slot). No schema metadata, no name→index resolution. Dispatch is then
        // a pure `(slotId) -> number` computer; the slot is self-describing via
        // SLOT_REF / SLOT_FIELD so the instance/string never reach the computer.
        const refId = refIdOf(instance);
        const slotIdx = refId === undefined ? undefined : this.slotByRef.get(refId)?.get(field);
        // `field: NumericKeys<T>` proves `instance[field]` is `number`.
        if (slotIdx === undefined) return instance[field] as number;
        const profileIdx = this.slotBuf[slotIdx * SLOT_STRIDE + SLOT_PROFILE] | 0;
        return this.profileComputers[profileIdx](slotIdx);
    }

    /**
     * RAW forward-projected value — the reckoned position WITHOUT the decaying
     * smooth-correction offset that {@link value} adds for rendering.
     *
     * Use this for GAME LOGIC (collision / hit tests), and {@link value} for
     * RENDERING. The offset exists only to hide snapshot-rebase pops on screen;
     * feeding it into a hit test makes the client judge an overlap against a
     * position a few cm off the physical prediction, which flips knife-edge
     * stomp/hit calls vs the server (the server reads the exact timeline, no
     * offset). For every non-reckon field this equals {@link value} — including
     * controller-bound fields: their exact predicted state lives on the
     * controller (`me.state` / `me.world`), not behind this read.
     */
    valueRaw<T extends object>(instance: T, field: NumericKeys<T>): number {
        const refId = refIdOf(instance);
        const slotIdx = refId === undefined ? undefined : this.slotByRef.get(refId)?.get(field);
        if (slotIdx === undefined) return instance[field] as number;
        const i = slotIdx * SLOT_STRIDE;
        const profileIdx = this.slotBuf[i + SLOT_PROFILE] | 0;
        // Only reckon has a raw-vs-smoothed split; other modes carry no offset.
        if (this.profileComputers[profileIdx] !== this.computeReckon) {
            return this.profileComputers[profileIdx](slotIdx);
        }
        const sim = this.simByRef.get(this.slotBuf[i + SLOT_REF]);
        if (sim !== undefined) {
            const fieldId = this.slotBuf[i + SLOT_FIELD] | 0;
            const pos = fieldId < sim.posOf.length ? sim.posOf[fieldId] : -1;
            // applySimulation refreshes out[]+smoothed[] for this frame (guarded);
            // we return the pre-offset `out`.
            if (pos >= 0) { this.applySimulation(sim, pos); return sim.out[pos]; }
        }
        return this.slotBuf[i + SLOT_V1];
    }

    /**
     * RAW reckoned value at an ARBITRARY server-time instant — the {@link valueRaw}
     * analog at a chosen `time` (server-clock ms). `valueRaw(e, f)` ≡
     * `valueAt(e, f, serverNow())`.
     *
     * For client-side collision/hit prediction, sample remote entities at the
     * input's `ctx.reckonTime` (the instant the server rewinds to) so the client's
     * hit call matches the server's lag-comp read BY CONSTRUCTION — on the live
     * step AND deterministically on rollback replay (same `time` per seq).
     *
     * Reckons FORWARD from the latest server snapshot to `time`: integrates the
     * tracked `step` from `lastServerTime()` to `time`, evaluating time-sampled
     * formulas (sinusoids, cooldown snaps) at `time`. The SDK keeps no per-entity
     * history, so `time ≤ lastServerTime()` CLAMPS to the snapshot (reckoning
     * into the past is the server rewind buffer's job — a non-reckonable discrete
     * motion you replay backward must be reconstructed from its own schedule). On
     * the live step `time = reckonTime ≈ serverNow() > lastServerTime()`, so it's
     * exact. Non-reckon / untracked fields ignore `time` and return {@link value}.
     */
    valueAt<T extends object>(instance: T, field: NumericKeys<T>, time: number): number {
        const refId = refIdOf(instance);
        const slotIdx = refId === undefined ? undefined : this.slotByRef.get(refId)?.get(field);
        if (slotIdx === undefined) return instance[field] as number;
        const i = slotIdx * SLOT_STRIDE;
        const profileIdx = this.slotBuf[i + SLOT_PROFILE] | 0;
        // Only reckon depends on the instant; lerp/damped/extrapolate/raw don't.
        if (this.profileComputers[profileIdx] !== this.computeReckon) {
            return this.profileComputers[profileIdx](slotIdx);
        }
        const sim = this.simByRef.get(this.slotBuf[i + SLOT_REF]);
        if (sim !== undefined) {
            const fieldId = this.slotBuf[i + SLOT_FIELD] | 0;
            const pos = fieldId < sim.posOf.length ? sim.posOf[fieldId] : -1;
            if (pos >= 0) {
                // Forward from the latest snapshot to `time` (clamped ≥ 0), absolute
                // end = `time`. Into `valueOut` so the per-frame render reckon
                // (out/smoothed/offset) is untouched. Raw — no smooth offset.
                const base = this.clock?.lastServerTime?.() ?? NaN;
                const fwd = Number.isNaN(base) ? 0 : Math.max(0, time - base);
                sim.advance(sim.instance, fwd, sim.valueOut, time);
                return sim.valueOut[pos];
            }
        }
        return this.slotBuf[i + SLOT_V1];
    }


    /**
     * Exponential smoothing toward the latest server value (`v1`). Reads
     * `damping` from the slot's profile.
     */
    private computeDamped = (slotIdx: number): number => {
        const buf = this.slotBuf;
        const i = slotIdx * SLOT_STRIDE;
        const pBuf = this.profileBuf;
        const pBase = (buf[i + SLOT_PROFILE] | 0) * PROFILE_STRIDE;
        const now = this.renderTime;
        const v1 = buf[i + SLOT_V1];

        const lastT = buf[i + SLOT_AUX_T];
        const dtFrame = now - lastT;
        buf[i + SLOT_AUX_T] = now;
        let damped = buf[i + SLOT_AUX_V];
        if (dtFrame > 0) {
            const k = 1 - Math.exp(-pBuf[pBase + P_DAMPING] * dtFrame / 1000);
            damped += (v1 - damped) * k;
            buf[i + SLOT_AUX_V] = damped;
        }
        return damped;
    };

    /**
     * Canonical entity interpolation:
     *   1. Render at `target = now - delay` (delay sized so the snapshot
     *      ring almost always brackets the target).
     *   2. Find the latest pair (k, k+1) with ts(k) <= target.
     *   3. Lerp between them. On underrun (target past newest snapshot) or
     *      warmup (only one snapshot), hold at the newest sample — *don't*
     *      extrapolate. Extrapolation here is what produced the "flickery"
     *      feel; bracketing changes happen at predictable render-time
     *      crossings, not at jittered packet arrivals.
     */
    private computeLerp = (slotIdx: number): number => {
        const buf = this.slotBuf;
        const i = slotIdx * SLOT_STRIDE;
        const pBuf = this.profileBuf;
        const pBase = (buf[i + SLOT_PROFILE] | 0) * PROFILE_STRIDE;
        const now = this.renderTime;

        const count = buf[i + SLOT_RING_COUNT] | 0;
        if (count === 0) return buf[i + SLOT_V1];
        const head = buf[i + SLOT_RING_HEAD] | 0;
        const ringBase = i + SLOT_RING_BASE;
        const start = (head - count + RING_CAP) % RING_CAP;

        const newestPhys = (start + count - 1) % RING_CAP;
        const newestOff = ringBase + newestPhys * 2;
        if (count === 1) return buf[newestOff + 1];

        // Render at the SAME instant the server's lag-comp rewinds to — the input's
        // renderTime = serverNow − renderDelay − rtt/2. On the server-time axis (clock
        // present) that `− rtt/2` must be explicit; the arrival axis got it implicitly from
        // transit. delay == renderDelay, so display == rewind → exact "what you see is what
        // you hit", AND jitter-immune (off the jitter-free server-stamped sample times).
        const delay = pBuf[pBase + P_DELAY];
        const target = (this.clock && this.clock.lastServerTime() > 0)
            ? this.clock.serverNow() - delay - this.clock.smoothedRtt() / 2
            : now - delay;
        const oldestOff = ringBase + start * 2;
        if (target <= buf[oldestOff]) return buf[oldestOff + 1];
        if (target >= buf[newestOff]) return buf[newestOff + 1];

        // Walk backwards from second-newest. Typical k is `count - 2` ⇒ O(1).
        let k = count - 2;
        let phys = (start + k) % RING_CAP;
        while (k > 0) {
            const tk = buf[ringBase + phys * 2];
            if (tk <= target) break;
            k--;
            phys = phys === 0 ? RING_CAP - 1 : phys - 1;
        }
        const aOff = ringBase + phys * 2;
        const bPhys = phys + 1 >= RING_CAP ? 0 : phys + 1;
        const bOff = ringBase + bPhys * 2;
        const tA = buf[aOff], tB = buf[bOff];
        const span = tB - tA;
        if (span <= 0) return buf[bOff + 1];
        const u = (target - tA) / span;
        const vA = buf[aOff + 1], vB = buf[bOff + 1];
        return vA + (vB - vA) * u;
    };

    /**
     * Ring-driven forward projection with predict-then-smooth output EMA.
     *   1. Anchor on the ring's newest snapshot.
     *   2. Slope from a 2-step lookback in the ring (~2 tick intervals)
     *      when available, else last-2 fallback.
     *   3. raw = anchor + slope · clamp(now − anchor.t, 0, maxExtrapolate).
     *   4. EMA-blend raw → smoothed using `damping` (0 disables → return raw).
     */
    private computeExtrapolate = (slotIdx: number): number => {
        const buf = this.slotBuf;
        const i = slotIdx * SLOT_STRIDE;
        const pBuf = this.profileBuf;
        const pBase = (buf[i + SLOT_PROFILE] | 0) * PROFILE_STRIDE;
        const now = this.renderTime;

        const count = buf[i + SLOT_RING_COUNT] | 0;
        if (count === 0) return buf[i + SLOT_V1];

        const head = buf[i + SLOT_RING_HEAD] | 0;
        const ringBase = i + SLOT_RING_BASE;
        const start = (head - count + RING_CAP) % RING_CAP;
        const newestPhys = (start + count - 1) % RING_CAP;
        const newestOff = ringBase + newestPhys * 2;
        const newestT = buf[newestOff];
        const newestV = buf[newestOff + 1];

        let raw: number;
        if (count === 1) {
            raw = newestV;
        } else {
            const steps = count >= 3 ? 2 : 1;
            const lbPhys = (start + count - 1 - steps + RING_CAP) % RING_CAP;
            const lbOff = ringBase + lbPhys * 2;
            const lbT = buf[lbOff];
            const lbV = buf[lbOff + 1];
            const dt = newestT - lbT;
            if (dt <= 0) {
                raw = newestV;
            } else {
                const slope = (newestV - lbV) / dt;
                const maxExt = pBuf[pBase + P_MAX_EXTRAPOLATE];
                let ahead = now - newestT;
                if (ahead < 0) ahead = 0;
                else if (ahead > maxExt) ahead = maxExt;
                raw = newestV + slope * ahead;
            }
        }

        // Predict-then-smooth. Reuses SLOT_AUX_V / SLOT_AUX_T (damped is the
        // other consumer; the two modes can't share a slot).
        const lastT = buf[i + SLOT_AUX_T];
        buf[i + SLOT_AUX_T] = now;
        const damping = pBuf[pBase + P_DAMPING];
        if (damping <= 0) {
            buf[i + SLOT_AUX_V] = raw;
            return raw;
        }
        const dtFrame = now - lastT;
        let smoothed = buf[i + SLOT_AUX_V];
        if (dtFrame > 0) {
            const k = 1 - Math.exp(-damping * dtFrame / 1000);
            smoothed += (raw - smoothed) * k;
            buf[i + SLOT_AUX_V] = smoothed;
        }
        return smoothed;
    };

    /**
     * Dead-reckoning dispatch. Recovers (refId, fieldId) from the slot, finds
     * the `SimState` registered by `trackStepped`, and runs predict-then-smooth.
     * If the slot's profile flipped to reckon at runtime but no SimState was
     * ever allocated (e.g. attach was smoothing-only), falls back to the latest
     * server value mirrored in SLOT_V1 — degraded but functional, no object
     * access.
     */
    private computeReckon = (slotIdx: number): number => {
        const buf = this.slotBuf;
        const i = slotIdx * SLOT_STRIDE;
        const refId = buf[i + SLOT_REF];
        const fieldId = buf[i + SLOT_FIELD] | 0;
        const sim = this.simByRef.get(refId);
        if (sim !== undefined) {
            // posOf maps fieldId → SoA position in one array index (no indexOf).
            const pos = fieldId < sim.posOf.length ? sim.posOf[fieldId] : -1;
            if (pos >= 0) return this.applySimulation(sim, pos);
        }
        return buf[i + SLOT_V1];
    };

    /**
     * Raw dispatch — return the latest server value as-is, no smoothing/
     * prediction. SLOT_V1 mirrors the latest sample on every update, so this
     * needs no object access. The slot ring still receives samples from the
     * listener (so a panel flip back to a smoothing mode works without
     * re-attach), but they're unused while raw is active.
     */
    private computeRaw = (slotIdx: number): number => {
        return this.slotBuf[slotIdx * SLOT_STRIDE + SLOT_V1];
    };

    /**
     * Bound-overlay dispatch — the slot's value is a rollback controller's
     * interpolated + smooth-corrected pose read (`ctrl.value(poseKey)`). Same
     * dispatch class as reckon's `simByRef` read: one side-table lookup, then
     * the controller read — which also runs the read-before-pump bookkeeping,
     * so `predict.value(entity, f)` and `me.value(f)` warn identically.
     */
    private computeBound = (slotIdx: number): number => {
        const e = this.boundBySlot.get(slotIdx);
        return e !== undefined ? e.ctrl.value(e.key) : this.slotBuf[slotIdx * SLOT_STRIDE + SLOT_V1];
    };


    // --- Internal smoothing math -----------------------------------------------

    /** `pos` indexes the SoA buffers (`sim.smoothed` / `sim.out`).
     *
     * Predict + OFFSET-DECAY smoothing (not an EMA chase): the display is
     * `out + offset`. Between snapshots the forward sim is continuous, so the
     * display moves at the target's full velocity — STEADY-STATE EXACT, no
     * systematic lag on a moving entity (an EMA chasing a mover lags it by
     * ~v/smoothing forever — enough to flip knife-edge hit calls vs the
     * server, which always reads the exact timeline). When a new SNAPSHOT
     * rebases the sim and the trajectory jumps (a real misprediction), the
     * discontinuity is captured into `offset` and decays out — the pop-hiding
     * the smoothing exists for. Same construction as the Reconciler's
     * error-decay for the local player.
     *
     * Without a clock (`lastBaseT` stays NaN — rebase undetectable), falls
     * back to the EMA chase. */
    private applySimulation(sim: SimState, pos: number): number {
        const now = this.renderTime;
        // Run `advance` once per render frame per instance, even if value() is
        // called for several fields. All math is indexed Float64Array access —
        // monomorphic, no per-frame allocation, no dynamic-key (megamorphic) hits.
        if (sim.lastApplyTime !== now) {
            const out = sim.out;
            const sm = sim.smoothed;
            const off = sim.offset;
            const n = sm.length;
            const baseT = this.clock?.lastServerTime?.() ?? NaN;
            sim.advance(sim.instance, sim.forwardMs(), out, sim.elapsedMs());
            const first = sim.lastApplyTime === -Infinity;
            if (first || sim.smoothing <= 0) {
                for (let k = 0; k < n; k++) { off[k] = 0; sm[k] = out[k]; }
            } else if (!Number.isNaN(baseT)) {
                const dtMs = Math.max(0, Math.min(now - sim.lastApplyTime, 100));
                if (baseT !== sim.lastBaseT && !Number.isNaN(sim.lastBaseT)) {
                    // REBASE: a new snapshot re-seeded the forward sim. `out`
                    // forwards by SNAPSHOT AGE, so across a clean patch it's
                    // already continuous — it just advanced one frame of REAL
                    // motion (≈ frameVel·dt). Subtract that expected motion so
                    // ONLY a genuine snapshot correction lands in the offset;
                    // without it every patch mis-reads v·dt of motion as a
                    // discontinuity (a per-patch sawtooth, amplitude independent
                    // of the decay rate). Past `snap` it's a teleport: pop.
                    const snap = sim.snap;
                    const vel = sim.frameVel;
                    for (let k = 0; k < n; k++) {
                        const d = sm[k] + vel[k] * dtMs - out[k];
                        off[k] = (snap > 0 && Math.abs(d) > snap) ? 0 : d;
                    }
                } else if (dtMs > 0) {
                    // Clean frame: record per-ms motion for the next rebase's
                    // expected-motion term.
                    const outPrev = sim.outPrev, vel = sim.frameVel;
                    for (let k = 0; k < n; k++) vel[k] = (out[k] - outPrev[k]) / dtMs;
                }
                const decay = Math.exp(-sim.smoothing * dtMs / 1000);
                for (let k = 0; k < n; k++) { off[k] *= decay; sm[k] = out[k] + off[k]; }
            } else {
                // No clock → no rebase signal: legacy predict-then-smooth EMA.
                const dtMs = Math.max(0, Math.min(now - sim.lastApplyTime, 100));
                const kk = 1 - Math.exp(-sim.smoothing * dtMs / 1000);
                for (let k = 0; k < n; k++) sm[k] += (out[k] - sm[k]) * kk;
            }
            const outPrev = sim.outPrev;
            for (let k = 0; k < n; k++) outPrev[k] = out[k];
            sim.lastBaseT = baseT;
            sim.lastApplyTime = now;
        }
        return sim.smoothed[pos];
    }
}

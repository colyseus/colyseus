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
 *     rewind to server truth + replay, smoothly correcting. Read with
 *     `controller.value(field)` (rendered) / `controller.state` (logic + mutate).
 *   - `predict.events(…)` → a {@link PredictedEvents} — optimistic DISCRETE
 *     events (a kill, a pickup) with confirm/TTL cleanup.
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
import { PredictedSpawns, type PredictedSpawnsOptions } from "./predictedSpawns.ts";
import { Reconciler, type ReconcilerOptions } from "./reconciler.ts";
import { SimReconciler, type SimReconcilerOptions } from "./simReconciler.ts";
import type { InputHandle } from "../input/InputHandle.ts";
import type { RoomClockLike } from "../RoomClock.ts";

// -----------------------------------------------------------------------------
// Schema-native identity. The decoder assigns every instance a stable integer
// `refId` (own, non-enumerable `Symbol.for("$refId")` property) and exposes a
// field-name → field-index map on `constructor[Symbol.metadata]`. These two
// integers — refId and field index — are the SAME identity the wire protocol
// and any C / C# port use, so Predict keys all of its runtime state on them
// rather than on JS object identity (WeakMap) or field-name strings. The
// instance object and the field-name string never reach the engine's hot path;
// they're resolved to `(refId, fieldId)` once at the API boundary below.
// -----------------------------------------------------------------------------

const $REF_ID: symbol = Symbol.for("$refId");
const $METADATA: symbol = (Symbol as { metadata?: symbol }).metadata ?? Symbol.for("Symbol.metadata");
/** Schema's own SoA: a dense array of a decoded instance's field values, indexed
 *  by field index. Reading/writing it bypasses the per-field accessor and the
 *  megamorphic dynamic-key path — reckon's scratch refill + extract use it. */
const $VALUES: symbol = Symbol.for("$values");

/** Stable integer id the decoder assigned this instance, or undefined if it
 *  hasn't been decoded yet (attach/track called too early — see file header). */
function refIdOf(instance: object): number | undefined {
    return (instance as Record<symbol, number | undefined>)[$REF_ID];
}

/** The schema metadata object: maps `name -> index` (number) and
 *  `index -> { name, index, type }` (MetadataField). Undefined for non-schema
 *  objects (e.g. plain test fixtures). */
type SchemaMetadata = Record<string | number, unknown>;
function metadataOf(instance: object): SchemaMetadata | undefined {
    return (instance.constructor as unknown as Record<symbol, SchemaMetadata | undefined>)[$METADATA];
}

/**
 * Field's declaration index from the schema's metadata, or -1 if unknown.
 * `metadata[name]` is the index. Only used on the COLD attach path (to stamp a
 * slot's SLOT_FIELD and seed reckon sim fields) — the hot `value()` read keys
 * its slot map by field NAME, so it never resolves an index per frame.
 */
function fieldIndexOf(instance: object, field: string): number {
    const idx = metadataOf(instance)?.[field];
    return typeof idx === "number" ? idx : -1;
}


/** PRIMITIVE (scalar) field names in declaration order, read from the schema
 *  metadata. Empty for non-schema objects. Field indices are dense from 0, so
 *  walk until the first gap.
 *
 *  Only number / string / boolean (and the other primitive encodings — int8,
 *  float32, …) are returned: in the metadata a primitive's `type` is a STRING
 *  ("number", "string", …) whereas a collection (Map/Array/Set) or a nested
 *  Schema carries an OBJECT `type`. The reckon snapshot uses this to clone the
 *  SCALAR state a `step` reads — including string/enum discriminators (`kind`)
 *  and booleans (`grounded`), which steps routinely branch on — while skipping
 *  reference-typed fields. Those are structural, not forward-simulated, and
 *  shallow-copying their reference into a scratch that `step` mutates could
 *  corrupt the live tree; for the rare step that needs one, pass an explicit
 *  `snapshot`. (Schema fields live behind getters over `$values`, so a plain
 *  `{...instance}` spread copies nothing — hence the metadata walk.) */
function scalarFieldNamesOf(instance: object): string[] {
    const meta = metadataOf(instance);
    if (!meta) return [];
    const names: string[] = [];
    for (let i = 0; ; i++) {
        const f = meta[i] as { name?: string; type?: unknown } | undefined;
        if (!f || typeof f.name !== "string") break;
        if (typeof f.type === "string") names.push(f.name); // skip collections / child schemas (object type)
    }
    return names;
}

/**
 * Build a snapshot fn that clones `fieldNames` from a live instance into a fresh
 * plain object. Used by reckon's GENERIC advance path — schema versions whose
 * decoded instances expose values as own properties / accessors rather than a
 * dense `$values` SoA (e.g. esbuild's class-field transform in the real browser,
 * where the `$values` fast path is unavailable and this is the path production
 * actually runs).
 *
 * Why not a plain `for` loop? A single `o[names[i]] = src[names[i]]` store site
 * sees every field name across one call, so V8 demotes it to
 * `KeyedStoreIC_Megamorphic` — the profiler put ~33% of reckon time there.
 * Unrolling gives each field its OWN store site; with a fixed field layout each
 * site sees exactly one key and stays MONOMORPHIC (no eval; ~2.4× faster
 * snapshot in isolation, ~+19% on the full reckon read). Names are captured as
 * locals so the `!== undefined` guard is a predictable branch. Field sets wider
 * than the unroll fall back to the megamorphic loop (rare — most schemas have
 * < 16 numeric+scalar fields).
 */
const SNAPSHOT_UNROLL_WIDTH = 16;
function makeUnrolledSnapshot(fieldNames: readonly string[]): (e: any) => any {
    if (fieldNames.length > SNAPSHOT_UNROLL_WIDTH) {
        const names = fieldNames;
        return (e: Record<string, unknown>) => {
            const o: Record<string, unknown> = {};
            for (let i = 0; i < names.length; i++) o[names[i]] = e[names[i]];
            return o;
        };
    }
    const n0 = fieldNames[0], n1 = fieldNames[1], n2 = fieldNames[2], n3 = fieldNames[3],
        n4 = fieldNames[4], n5 = fieldNames[5], n6 = fieldNames[6], n7 = fieldNames[7],
        n8 = fieldNames[8], n9 = fieldNames[9], n10 = fieldNames[10], n11 = fieldNames[11],
        n12 = fieldNames[12], n13 = fieldNames[13], n14 = fieldNames[14], n15 = fieldNames[15];
    return (e: Record<string, unknown>) => {
        const o: Record<string, unknown> = {};
        if (n0 !== undefined) o[n0] = e[n0]; if (n1 !== undefined) o[n1] = e[n1];
        if (n2 !== undefined) o[n2] = e[n2]; if (n3 !== undefined) o[n3] = e[n3];
        if (n4 !== undefined) o[n4] = e[n4]; if (n5 !== undefined) o[n5] = e[n5];
        if (n6 !== undefined) o[n6] = e[n6]; if (n7 !== undefined) o[n7] = e[n7];
        if (n8 !== undefined) o[n8] = e[n8]; if (n9 !== undefined) o[n9] = e[n9];
        if (n10 !== undefined) o[n10] = e[n10]; if (n11 !== undefined) o[n11] = e[n11];
        if (n12 !== undefined) o[n12] = e[n12]; if (n13 !== undefined) o[n13] = e[n13];
        if (n14 !== undefined) o[n14] = e[n14]; if (n15 !== undefined) o[n15] = e[n15];
        return o;
    };
}

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
const GAP_RESUME_MULT = 3;      // collapse when gap > MULT × recent interval
const GAP_RESUME_MAX_MS = 250;  // cap the synthesized resume span (safety)

// Profile table — packed Float64Array, stride 5. Profile 0 is the Predict's
// *defaults* (mutable; setDefaults edits it in place). Profiles 1..N are
// *frozen* per-call configs, allocated when an attach overrides any defaults.
// Frozen profiles are value-deduplicated via `profileKeys` so that an
// attachAll on a thousand entities sharing the same override still allocates
// just one extra profile, not a thousand.
const PROFILE_STRIDE = 5;
const P_MODE = 0;
const P_DELAY = 1;
const P_DAMPING = 2;
const P_MAX_EXTRAPOLATE = 3;
const P_TICK_INTERVAL = 4;
const DEFAULTS_PROFILE = 0;

const MODE_LERP = 0;
const MODE_EXTRAPOLATE = 1;
const MODE_DAMPED = 2;
const MODE_RECKON = 3;
const MODE_RAW = 4;
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
    /** Override how the per-frame scratch is built. Defaults to copying every
     *  schema field through its accessor (or a plain spread for non-schema
     *  objects). Override only for exotic instances the default can't clone. */
    snapshot?: (instance: T) => T;
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
     */
    advance: (instance: T, forwardMs: number, out: Float64Array) => void;
    /**
     * Damping for predict-then-smooth (spring constant, same units as the
     * `damped` mode). Default 20 (~50 ms half-life). Set to 0 to snap directly
     * to the `advance` output every frame.
     */
    smoothing?: number;
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
    advance: (instance: any, forwardMs: number, out: Float64Array) => void;
    smoothing: number;
    /** Displayed values (= `out + offset`), indexed by field position. */
    smoothed: Float64Array;
    /** Reused per-frame `advance` output, indexed by field position. */
    out: Float64Array;
    /** Pop-hiding correction offset, decaying toward 0 (see applySimulation). */
    offset: Float64Array;
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
    angle: false,
};

/** Reckon-mode defaults. `step` stays undefined — must be supplied at construct time
 *  or per-attach; otherwise `attach`/`attachAll` throws. */
interface ReckonDefaults {
    step: ((state: any, dt: number, elapsedMs: number) => void) | undefined;
    smoothing: number;
    substep: number;
}
const RECKON_DEFAULTS: ReckonDefaults = {
    step: undefined,
    smoothing: 20,
    substep: 16,
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
}

interface ColyseusDebugRegistry {
    publish(channel: "predict", handle: PredictCore): void;
}

function getDebugRegistry(): ColyseusDebugRegistry | undefined {
    return (globalThis as { __colyseusDebug?: ColyseusDebugRegistry }).__colyseusDebug;
}

let __predictAutoId = 0;

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
    private renderTime = 0;
    private defaultMode: PredictMode;
    private reckonDefaults: ReckonDefaults;
    private clock: RoomClockLike | undefined;

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
            };
        } else {
            this.reckonDefaults = { ...RECKON_DEFAULTS };
        }
        // Prefer caller-supplied clock; otherwise inherit `room.clock` (set
        // by the SDK when the server called `defineInput()`). Stays undefined
        // for rooms without a clock — `trackStepped` then requires explicit
        // forwardMs/elapsedMs.
        this.clock = clock ?? (room as { clock?: RoomClockLike | null }).clock ?? undefined;

        this.name = (rest as { name?: string }).name ?? `predict#${++__predictAutoId}`;

        // Publish a core handle to the debug registry only when
        // `@colyseus/sdk/debug` is loaded — keeps the production path
        // zero-bookkeeping (no listeners ⇒ `trackWithProfile`'s notify is a
        // length check, and `attachedCount` reads an already-maintained map).
        const registry = getDebugRegistry();
        if (registry) {
            registry.publish("predict", this.makeCoreHandle());
        }
    }

    /**
     * Predictor's current default mode. Reflects mutations via {@link setDefaults}
     * (and therefore the SDK debug panel), so consumers that need to react to
     * mode changes can read this each frame.
     */
    get mode(): PredictMode {
        return this.defaultMode;
    }

    // --- Core introspection handle ---------------------------------------------

    private makeCoreHandle(): PredictCore {
        return {
            name: this.name,
            mode: () => this.defaultMode,
            smoothingDefaults: () => this.readSmoothingDefaults(),
            reckonDefaults: () => ({ ...this.reckonDefaults }),
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

    private readSmoothingDefaults(): { mode: PredictMode; delay: number; damping: number; maxExtrapolate: number; tickInterval: number } {
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
        };
    }

    /**
     * Look up or allocate a profile matching the given values. With
     * `dedup=true`, an identical existing profile is reused — so an attachAll
     * over 1000 entities with the same per-field config still allocates one
     * profile, not 1000.
     */
    private allocProfile(
        mode: PredictMode,
        delay: number,
        damping: number,
        maxExtrapolate: number,
        tickInterval: number,
        dedup: boolean,
        label?: string,
    ): number {
        const modeCode = MODE_CODES[mode];
        let key = "";
        if (dedup) {
            // Label is part of the key: two groups never share a profile, so
            // their panel cards stay independent.
            key = `${label ?? ""}|${modeCode}|${delay}|${damping}|${maxExtrapolate}|${tickInterval}`;
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
            opts.tickInterval === undefined
        ) {
            return DEFAULTS_PROFILE;
        }
        const d = this.readSmoothingDefaults();
        const mode = (opts.mode ?? d.mode) as PredictMode;
        const delay = opts.delay ?? d.delay;
        const damping = opts.damping ?? d.damping;
        const maxExtrapolate = opts.maxExtrapolate ?? d.maxExtrapolate;
        const tickInterval = opts.tickInterval ?? d.tickInterval;
        // Collapse to defaults profile when the merged values match it. This
        // unifies homogeneous per-attach configs (e.g. `{ mode: "lerp" }` on
        // a Predict already at lerp) with the implicit no-override case —
        // ensuring there's exactly one internal state for any given intent.
        if (
            mode === d.mode && delay === d.delay && damping === d.damping &&
            maxExtrapolate === d.maxExtrapolate && tickInterval === d.tickInterval
        ) {
            return DEFAULTS_PROFILE;
        }
        return this.allocProfile(mode, delay, damping, maxExtrapolate, tickInterval, true);
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
        opts: { mode?: PredictMode; delay?: number; damping?: number; maxExtrapolate?: number; tickInterval?: number },
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
        if (this.slotByRef.get(refId)?.get(field) !== undefined) this.untrackSlot(refId, field);

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

        let perRef = this.slotByRef.get(refId);
        if (perRef === undefined) { perRef = new Map(); this.slotByRef.set(refId, perRef); }
        perRef.set(field, slotIdx);

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
                const now = performance.now();
                const b = this.slotBuf;
                const i = slotIdx * SLOT_STRIDE;
                // Angle field: fold the new wrapped value onto the last stored (continuous)
                // one over the shortest arc, so the ring stays monotonic across ±π and the
                // interpolators never spin the long way. sin/cos make the delta period-2π.
                if (angle) { const prev = b[i + SLOT_V1]; current = prev + Math.atan2(Math.sin(current - prev), Math.cos(current - prev)); }
                const pBase = (b[i + SLOT_PROFILE] | 0) * PROFILE_STRIDE;
                const tickInterval = this.profileBuf[pBase + P_TICK_INTERVAL];

                // Derive lastT1 (timestamp of the previous newest snapshot)
                // straight from the ring — no per-slot t1 field needed.
                let head = b[i + SLOT_RING_HEAD] | 0;
                let count = b[i + SLOT_RING_COUNT] | 0;
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
                    if (lastInterval > 0 && (snapT - lastT1) > GAP_RESUME_MULT * lastInterval) {
                        const resumeSpan = lastInterval < GAP_RESUME_MAX_MS ? lastInterval : GAP_RESUME_MAX_MS;
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
        this.slotDetach[slotIdx]?.();
        this.slotDetach[slotIdx] = undefined;
        this.freeSlots.push(slotIdx);
        perRef!.delete(field);
        if (perRef!.size === 0) this.slotByRef.delete(refId);
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
        // knife-edge hit verdicts). Override `forwardMs` for a different
        // horizon (e.g. a collision read wanting extra look-ahead).
        const smoothing = opts.smoothing ?? 20;
        const forwardMs = opts.forwardMs ?? (clock
            ? () => { const stamp = clock.lastServerTime(); return stamp > 0 ? Math.max(0, clock.serverNow() - stamp) : 0; }
            : () => 0);
        const elapsedMs = opts.elapsedMs ?? (clock
            ? () => clock.serverNow()
            : () => performance.now());

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
        let advance: (live: T, fwd: number, out: Float64Array) => void;
        if (fastPathOk) {
            // SoA fast path (decoded schema instances). The scratch is a pooled
            // instance of the same type; each frame we refill its `$values`
            // array BY INDEX from the live instance (no dynamic-key object
            // building → no V8 dictionary mode, no megamorphic keyed store),
            // let `step` mutate it through its accessors, then extract the
            // predicted fields BY INDEX. Fully monomorphic + zero allocation.
            const scratch = new (instance.constructor as new () => T)();
            const sv = (scratch as Record<symbol, number[]>)[$VALUES];
            advance = (live, fwd, out) => {
                const lv = (live as Record<symbol, number[]>)[$VALUES];
                for (let i = 0; i < lv.length; i++) sv[i] = lv[i];
                let remaining = fwd;
                // The scratch is the SNAPSHOT state (age `fwd` ago), so absolute
                // time runs from `elapsedMs() − fwd` and the LAST substep lands
                // exactly on elapsedMs() — time-SAMPLED fields (sinusoids,
                // cooldown snaps) then read the same instant the input stamp
                // claims. Starting at elapsedMs() instead would evaluate them
                // `fwd` ms (≈ one-way latency) in the future — a latency-scaled
                // desync the server's lag-comp read can't cancel.
                let elapsed = elapsedMs() - fwd;
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
            advance = (live, fwd, out) => {
                const scratch = snapshotFn(live) as Record<string, unknown>;
                let remaining = fwd;
                // Snapshot-relative absolute time — see the fast path above.
                let elapsed = elapsedMs() - fwd;
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
            smoothing: opts.smoothing,
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
        const state: SimState = {
            instance,
            fieldIds,
            posOf,
            forwardMs: opts.forwardMs,
            advance: opts.advance as SimState["advance"],
            smoothing: opts.smoothing ?? 20,
            smoothed,
            out: new Float64Array(n),
            offset: new Float64Array(n),
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
            const profileIdx = this.groupProfile({ mode: effectiveMode }, label);
            for (const f of rcfg.fields) fieldProfiles.push({ field: f as string, profileIdx, angle: rcfg.angle });
            return {
                label,
                isReckon,
                reckonFields: isReckon ? (rcfg.fields as readonly string[]) : undefined,
                reckonStep: isReckon ? step : undefined,
                reckonSmoothing: rcfg.smoothing ?? this.reckonDefaults.smoothing,
                reckonSubstep: rcfg.substep ?? this.reckonDefaults.substep,
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

    /** Attach one child using a pre-resolved {@link GroupPlan}. */
    private attachToGroup<T extends object>(instance: T, plan: GroupPlan): () => void {
        const offs: Array<() => void> = [];
        if (plan.isReckon) {
            offs.push(this.trackStepped<T>(instance, {
                fields: plan.reckonFields as readonly (keyof T & string)[],
                step: plan.reckonStep as (s: T, dt: number, e: number) => void,
                smoothing: plan.reckonSmoothing,
                substep: plan.reckonSubstep,
                snapshot: plan.reckonSnapshot as ((s: T) => T) | undefined,
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
        if (perRef) for (const field of [...perRef.keys()]) this.untrackSlot(refId, field);
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
     * prediction stack. Advances smoothing (lerp/extrapolate/damped/reckon),
     * ticks every {@link controller} spawned from this Predict, and prunes every
     * {@link events} store. `now` defaults to `performance.now()`; pass it
     * explicitly when ticking multiple Predicts in the same frame so they share
     * one frame-time reference.
     */
    tick(now: number = performance.now()): void {
        this.renderTime = now;
        // Drive children; compact out any disposed ones in the same pass.
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
    }

    // --- Sibling-store factory -------------------------------------------------

    /**
     * Spawn a {@link PredictedEvents} store bound to this Predict's clock.
     * Convenience for callers that already have a Predict — equivalent to
     * `PredictedEvents.get(room, opts)` but reuses the cached clock so the
     * `room` reference doesn't need to be reached for again.
     *
     * For applications without a Predict, use `PredictedEvents.get(room)`
     * directly — it doesn't require constructing a Predict you won't use.
     *
     * The returned store is auto-pruned by this Predict's {@link tick} each
     * frame — no separate `prune()` call needed.
     */
    events<K = string>(opts: PredictedEventsGetOptions = {}): PredictedEvents<K> {
        const store = PredictedEvents.get<K>({ clock: this.clock }, opts);
        this.driven.push(store as { prune?(): void });
        return store;
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
     * The server element type `S` is inferred from `key`; the predicted-local
     * shape defaults to `Partial<S>`, so `spawn()` is type-checked against the
     * server fields with no annotations. To carry client-only fields, annotate
     * a callback param (e.g. `step: (b: { x: number; speed: number }, dt) => …`)
     * and `L` is inferred from it. An optional `data` factory gives each entry
     * an auto-cleaned render-scratch slot (`entry.data: D`), inferred from its
     * return.
     *
     * ```ts
     * const bullets = predict.spawns("bullets", {
     *   owned:     b => b.ownerId === room.sessionId,   // b: Bullet
     *   correlate: "fifo",
     *   step:      (b, dt) => {                          // b: Partial<Bullet>, inferred
     *     b.x += Math.cos(b.angle!) * SPEED * dt;
     *     b.y += Math.sin(b.angle!) * SPEED * dt;
     *   },
     *   data:      () => ({ catchup: 0, hidden: false }), // per-entry scratch
     * });
     * const h = bullets.spawn({ x, y, angle, spawnTime: room.clock.serverNow() });
     * // render: for (const e of bullets.entries()) {
     * //   if (e.data.hidden) continue;
     * //   draw(e.id, e.server ?? e.local);
     * // }
     * ```
     */
    spawns<K extends CollectionKeys<TState>, L = Partial<ChildOf<TState[K]>>, D = undefined>(
        key: K,
        opts: PredictedSpawnsOptions<ChildOf<TState[K]>, L, D> = {},
    ): PredictedSpawns<ChildOf<TState[K]>, L, D> {
        const store = new PredictedSpawns<ChildOf<TState[K]>, L, D>(opts, this.clock ?? null);
        store.attach((onAdd, onRemove) => {
            const addOff = this.callbacks.onAdd(key, onAdd);
            const removeOff = this.callbacks.onRemove(key, onRemove);
            return () => { addOff?.(); removeOff?.(); };
        });
        this.driven.push(store as { tick?(now: number): void; prune?(): void; dead?: boolean });
        return store;
    }

    /**
     * Spawn a {@link Reconciler} for a locally-controlled entity — server-
     * reconciled rollback (predict your inputs immediately, rewind to the
     * server's authoritative state + replay unacked inputs, smoothly correcting
     * mispredictions). The active counterpart to this Predict's passive modes:
     * use `reconciler()` for the entity you control, lerp/reckon for the rest.
     *
     * Driven by the `opts.input` handle (`room.input(...)`): it predicts +
     * transmits through it and reads the server ack (`input.lastProcessed`) off
     * it — the channel you send on is the channel that knows what's acked.
     *
     * The returned controller is auto-ticked by this Predict's {@link tick}
     * each frame (reconcile + smooth-correction decay) — no separate `tick()`
     * call needed, which is exactly the drive that's easy to forget.
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
        const recon = new Reconciler<S, Data<W>>(instance, opts);
        this.driven.push(recon as { tick?(now: number): void; dead?: boolean });
        return recon;
    }

    /**
     * Spawn a {@link SimReconciler} for the entity (or entities) your inputs
     * control — server-reconciled rollback (predict immediately, rewind to the
     * server's authoritative state + replay unacked inputs, smoothly correcting
     * mispredictions) — when their truth isn't a single flat scalar `fields` list:
     * composite scalar state across several schema instances (a paddle + the puck
     * it strikes, reconciled together), or an opaque engine handle (Rapier,
     * crashcat). Your `world` owns the state via `step` / `adopt` / `pose`
     * callbacks; the controller runs the loop and passes the world handle to each.
     *
     * Like {@link reconciler}, the returned controller is auto-ticked by this
     * Predict's {@link tick} each frame (reconcile + smooth-correction decay).
     */
    sim<W, P extends Record<string, number>, E>(
        opts: Omit<SimReconcilerOptions<Data<W>, P, E>, "input"> & { input: InputHandle<W> },
    ): SimReconciler<Data<W>, P, E> {
        // wire input `W` from `opts.input`, pose `P` from `opts.pose`, world handle
        // `E` from `opts.world` — none written at the call site, and `step`'s `cmd`
        // is contextually typed `Data<W>`.
        const ctl = new SimReconciler<Data<W>, P, E>(opts as SimReconcilerOptions<Data<W>, P, E>);
        this.driven.push(ctl as { tick?(now: number): void; dead?: boolean });
        return ctl;
    }

    // --- Reads -----------------------------------------------------------------

    /**
     * Smoothed/predicted value for a numeric field. Falls through to raw
     * `instance[field]` if the field isn't being tracked.
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

        const target = now - pBuf[pBase + P_DELAY];
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


    // --- Internal smoothing math -----------------------------------------------

    /** `pos` indexes the SoA buffers (`sim.smoothed` / `sim.out`).
     *
     * Predict + OFFSET-DECAY smoothing (not an EMA chase): the display is
     * `out + offset`. Between snapshots the forward sim is continuous, so the
     * display moves at the target's full velocity — STEADY-STATE EXACT, no
     * systematic lag on a moving entity (an EMA chasing a mover lags it by
     * ~v/smoothing forever — enough to flip knife-edge hit verdicts vs the
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
            sim.advance(sim.instance, sim.forwardMs(), out);
            if (sim.lastApplyTime === -Infinity || sim.smoothing <= 0) {
                for (let k = 0; k < n; k++) { off[k] = 0; sm[k] = out[k]; }
            } else if (!Number.isNaN(baseT)) {
                if (baseT !== sim.lastBaseT && !Number.isNaN(sim.lastBaseT)) {
                    // REBASE: a new snapshot re-seeded the forward sim — keep the
                    // display continuous by absorbing the jump into the offset.
                    for (let k = 0; k < n; k++) off[k] = sm[k] - out[k];
                }
                const dtMs = Math.max(0, Math.min(now - sim.lastApplyTime, 100));
                const decay = Math.exp(-sim.smoothing * dtMs / 1000);
                for (let k = 0; k < n; k++) { off[k] *= decay; sm[k] = out[k] + off[k]; }
            } else {
                // No clock → no rebase signal: legacy predict-then-smooth EMA.
                const dtMs = Math.max(0, Math.min(now - sim.lastApplyTime, 100));
                const kk = 1 - Math.exp(-sim.smoothing * dtMs / 1000);
                for (let k = 0; k < n; k++) sm[k] += (out[k] - sm[k]) * kk;
            }
            sim.lastBaseT = baseT;
            sim.lastApplyTime = now;
        }
        return sim.smoothed[pos];
    }
}

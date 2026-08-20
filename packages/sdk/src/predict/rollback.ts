/**
 * RollbackController — the shared server-reconciled rollback engine behind both
 * {@link Reconciler} (flat `fields` mirrored off one schema instance) and
 * `SimReconciler` (composite `world` + `adopt`/`pose` callbacks).
 *
 * Both controllers run the SAME loop: step each input the app sends immediately
 * (zero-latency local feel), buffer the unacknowledged ones on the input handle,
 * and when the server's authoritative state arrives rewind to that truth and
 * replay the still-unacked inputs on top — the rewind-and-replay rollback loop,
 * with the *server* as the authority that provides the restore point. They differ
 * only in WHERE the predicted state lives and how truth is adopted / read back for
 * rendering; everything else — the ack poll, the reconcile scaffold, smooth error
 * correction, `ctx.memo` memoization, drift telemetry — is identical and lives here.
 *
 * The acknowledgement lives on the INPUT HANDLE, not a clock: inputs go through
 * `room.input(...)`, so that handle knows the server ack (`input.lastProcessed`)
 * and the seq you've sent (`input.sentCount`). Reconcile is driven by polling
 * `lastProcessed` in {@link tick} — no schema field, no per-field subscription.
 *
 * Smooth error correction: a misprediction is absorbed into a per-field visual
 * offset (error = renderedBefore − correctedLocal) that decays to 0 over a few
 * frames, so corrections never pop. Correct predictions ⇒ ~zero offset.
 *
 * OBSERVER MODEL — the controller never stages or sends. You mutate + send through
 * the handle directly (`input.data.x = …; input.send()`); the controller subscribes
 * to the handle's {@link InputHandle.onSend} and steps its predicted simulation for
 * each sent input right then, so the render reads stay pure. Fixed-timestep pacing
 * lives on the owning `Predict`: `predict.tick(now)` returns HOW MANY fixed steps
 * are due this frame and pushes the interpolation `alpha` in via {@link tick}. The
 * user loop stays callback-free (`for (n) { input.data = …; input.send() }`) so it
 * ports to C# / C / Lua by transcription — only the loop and transport live in the shell.
 *
 * The subclass supplies the small set of hooks that genuinely differ:
 *   - {@link smoothedFields} / {@link readCurrent} — the numeric field set that
 *     gets smoothed, and how to read one's current predicted value.
 *   - {@link adoptTruth} — seed the server's authoritative state before replay.
 *   - {@link applyStep} — run the user step for one buffered input (live or replay).
 *   - {@link snapshotPrev} — capture the pre-step smoothed value for interpolation.
 *   - {@link reseedState} — re-seed local state on a hard {@link reset}.
 *   - {@link refreshRender} / {@link markDirty} — optional post-hooks (a pose
 *     reconciler re-samples its pose + marks its render cache dirty; the flat one no-ops).
 */

// Drives + reads acks through `room.input(...)`'s handle (type-only, erased).
import type { InputHandle } from "../input/InputHandle.ts";
import { newDrift, updateDrift, resetDrift, classifyDrift, type Drift } from "./drift.ts";
import { warnDivergence, warnReadBeforePump, warnMemoCollision, diagnosticsActive } from "./divergence.ts";

/**
 * Per-seq memo backing {@link StepContext.memo}: run a closure ONCE on the
 * live step, freeze its result keyed by `(seq, key)`, and on every rollback
 * REPLAY of that seq return the frozen value WITHOUT re-running it. Pruned when
 * the seq is acked, cleared on reset. Shared by {@link Reconciler} and
 * `SimReconciler` (both replay the same per-seq input buffer the same way).
 *
 * Storage is sparse — only seqs that memoized ≥1 value get an entry — so it
 * stays as small as the hand-rolled per-seq Maps it replaces. With dev
 * diagnostics on, warns once per key when two calls in one step share a slot.
 */
class MemoStore {
    /** seq → (key → memoized value). */
    private byTick = new Map<number, Map<string, any>>();

    // Collision diagnostic (live path, diagnostics-gated): keys seen this tick.
    // Tracked separately from byTick — undefined computes are never stored there.
    private diagTick = -1;
    private diagKeys = new Set<string>();
    private warnedKeys = new Set<string>();

    /**
     * LIVE (`isReplay=false`): run `compute`, memoize a non-`undefined` result
     * under `(tick, key)`, return it. REPLAY (`isReplay=true`): return the memo
     * (or `undefined` if the live step memoized none) WITHOUT running `compute`.
     */
    run<T>(tick: number, isReplay: boolean, key: string, compute: () => T): T | undefined {
        if (isReplay) return this.byTick.get(tick)?.get(key) as T | undefined;
        if (diagnosticsActive()) {
            if (tick !== this.diagTick) { this.diagTick = tick; this.diagKeys.clear(); }
            else if (this.diagKeys.has(key) && !this.warnedKeys.has(key)) {
                this.warnedKeys.add(key);
                warnMemoCollision(tick, key);
            }
            this.diagKeys.add(key);
        }
        const v = compute();
        if (v !== undefined) {
            let m = this.byTick.get(tick);
            if (m === undefined) { m = new Map(); this.byTick.set(tick, m); }
            m.set(key, v);
        }
        return v;
    }

    /** Drop memos for seqs the server has acked (they'll never replay again). */
    prune(acked: number): void {
        for (const tick of this.byTick.keys()) if (tick <= acked) this.byTick.delete(tick);
    }

    clear(): void {
        this.byTick.clear();
        // Epoch reset reuses tick numbers — stale diag state would false-positive.
        // warnedKeys survives: warn-once per store lifetime, no re-spam on respawn.
        this.diagTick = -1;
        this.diagKeys.clear();
    }
}

/**
 * Per-step context handed to a reconciler's `step`. Mirrors the server's
 * `StepContext` (@colyseus/core) so ONE fixed `dt` drives both sides of the
 * rollback. Carries only the fixed step — never wall-clock time.
 */
export interface StepContext {
  /** Fixed step in SECONDS (`1/tickRate`) — the dt to integrate this step with. */
  readonly dt: number;
  /** Fixed step in MILLISECONDS (`1000/tickRate`). */
  readonly dtMs: number;
  /** The input's sequence (= `input.sentCount`), which IS the index of the step
   *  being simulated — during replay it's the historical seq, not a fresh count. */
  readonly tick: number;
  /**
   * Physics sub-steps per fixed step (≥ 1) — mirrors the server's
   * `setFixedTimestep(..., { subSteps })`, cascaded through the join handshake.
   * One input still drives ONE `step` call (live and replayed alike — the
   * replay invariant is untouched); inside it, integrate your engine
   * `subSteps` times at {@link subDt}:
   * `for (let i = 0; i < ctx.subSteps; i++) world.step(ctx.subDt)` —
   * the same loop the server runs, so physics can run at `tickRate * subSteps`
   * Hz while only `tickRate` inputs/sec cross the wire. `1` when the server
   * doesn't sub-step, in which case `subDt === dt` and the loop above
   * degenerates to a single full step — one shared `step` fn covers both.
   */
  readonly subSteps: number;
  /** Physics sub-step in SECONDS (`dt / subSteps`) — bit-identical to the
   *  server's `ctx.subDt`. Equals {@link dt} when `subSteps` is 1. */
  readonly subDt: number;
  /** Physics sub-step in MILLISECONDS (`dtMs / subSteps`). */
  readonly subDtMs: number;
  /**
   * `false` on the live, first-time step of a fresh input; `true` while the
   * reconciler RE-simulates an already-applied input during rollback (it rewinds
   * to the server's authoritative state, then replays every still-unacked input
   * on top to catch back up).
   *
   * Why it matters: one input is replayed 0..N times — once per reconcile until
   * the server acks it (often several frames). Deterministic simulation (your
   * `applyInput`) MUST re-run every time, or replay won't reproduce the server.
   * But anything one-shot must not: this is the standard re-simulation flag
   * rollback netcode exposes.
   *
   * The one-shot family has three legs, split by shape:
   * - {@link memo} — one-shot VALUES the sim consumes (frozen, replayed back);
   * - {@link predict} — one-shot EVENTS with settlement (confirm / auto-reject);
   * - `if (!ctx.isReplay) { … }` — fire-and-forget PRESENTATION (a sound,
   *   particles, camera shake, a timestamp): a plain branch on this flag IS the
   *   idiom, deliberately not a wrapper API — a branch transcribes to any
   *   language a port targets; a closure-taking helper doesn't.
   */
  readonly isReplay: boolean;
  /**
   * The input's reckon instant (server-clock ms) — the client's `serverNow()`
   * estimate when this input was sent, the SAME value the server reads as
   * `channel.reckonTime` / `rewind.lastSeenBy(sid)`. Buffered per-seq on the
   * input handle, so it's identical on the live step and on every replay of
   * that seq.
   *
   * Hit-test remote entities at this instant — sample moving solids at
   * `reckonTime`, reckon other entities with `predict.valueAt(e, field,
   * reckonTime)` — and your client verdict matches the server's lag-comp rewind
   * BY CONSTRUCTION ("what you see is what you hit"), including for discrete
   * motion. Because it's the same value per seq across rollbacks, collision in
   * the step replays deterministically.
   *
   * Always a usable instant when the controller has a clock (automatic when
   * spawned via `predict.reconciler()` / `predict.sim()`): a seq that wasn't
   * stamped for lag-comp (the room never rewinds, clock not yet synced, seq
   * aged out) resolves to the clock's live `serverNow()` — the fallback
   * consumers previously wrote by hand. Check {@link lagCompActive} to
   * distinguish. An unstamped seq re-reads the live `serverNow()` on each
   * replay — that was never deterministic (consumers substituted live
   * `serverNow()` there anyway); stamped seqs stay per-seq-buffered and
   * replay-deterministic. `0` only on a bare controller constructed without a
   * clock.
   */
  readonly reckonTime: number;
  /**
   * Whether THIS seq carried a reckon lag-comp stamp — the server rewinds to
   * {@link reckonTime} for it, and the value is the buffered per-seq stamp
   * (replay-deterministic). `false` ⇒ `reckonTime` resolved to the live
   * `serverNow()`. The gate for the rare "skip the lag-comp read entirely"
   * consumer.
   */
  readonly lagCompActive: boolean;
  /**
   * Memoize a VALUE on the rollback timeline that replay can't re-derive: a
   * lag-comp'd collision outcome (its `reckonTime` interp samples age out), an
   * RNG roll, a server-assigned id. `compute` runs exactly ONCE — on the LIVE
   * step for this seq — and its result is frozen; every rollback REPLAY of
   * this seq gets the frozen value back WITHOUT re-running `compute`, so
   * re-simulation stays deterministic. Auto-pruned when the seq is acked,
   * cleared on `reset()`.
   *
   *     const hit = ctx.memo(() => collide(state, ctx.reckonTime));
   *     if (hit) state.vx = hit.vx;   // re-applied identically on every replay
   *
   * `compute` should return `undefined` for "nothing this seq" (stored
   * sparsely — costs nothing). Call `memo` on EVERY step (let `compute` decide
   * the value) rather than conditionally, so replay sees the same call shape.
   * A step that keeps MORE THAN ONE memo disambiguates them with the `key`
   * overload — `ctx.memo("collide", …)`; the key-less form is ONE shared slot
   * per step. Two calls landing on the same slot in one step (two key-less
   * calls, or a repeated key) silently corrupt replay — both call sites get
   * the one frozen value back; dev diagnostics warn on the collision.
   *
   * Prefer reconciled `fields` when the value IS derivable by re-running the
   * step (sync it, both sides simulate it) — that replays AND self-corrects for
   * free. Reach for `memo` only when it genuinely can't be re-derived, and
   * NEVER reconstruct such a value via an `input.at(seq)` lookback (it ages out
   * the moment the seq is acked — the snap-back this primitive exists to prevent).
   * For one-shot EVENTS (a sound, a celebration, a spawn) use {@link predict} —
   * events belong to a channel with settlement; a memo is a value the sim
   * itself consumes.
   */
  memo<T>(compute: () => T): T | undefined;
  memo<T>(key: string, compute: () => T): T | undefined;
  /**
   * Declare an optimistic discrete EVENT the timeline just produced (a goal, a
   * kill, a pickup) into an event channel (`predict.defineEvent(...)`). Fires
   * only on the LIVE step — silently skipped on every rollback replay, so a
   * re-simulated crossing never re-fires feedback. The channel handles the
   * rest of the event's lifecycle: pending-dedupe, cooldown, server
   * confirm / ack-anchored auto-reject.
   *
   * The sibling of {@link memo}, split by shape: `memo` freezes a VALUE
   * the replay consumes (use the return); `predict` declares an EVENT for the
   * world outside the sim (no return — the channel's `onPredict` callback is
   * the consumer).
   */
  predict<T>(sink: PredictSink<T>, payload: T): void;
}

/**
 * Minimal shape {@link StepContext.predict} emits into — implemented by
 * `PredictedEventChannel` (see `predict.defineEvent(...)`). Declared here,
 * structurally, so this module never imports the channel (no cycle); anything
 * with a `_predictFromSim` can receive sim-born predictions.
 */
export interface PredictSink<T> {
  /**
   * Receive one sim-born prediction from the LIVE step at `seq`. `acked`
   * reports the emitting controller's server-ack watermark
   * (`input.lastProcessed`) — the receiver anchors the entry's settlement to
   * it: once the server has processed past `seq` without confirming, the
   * predicted event didn't happen (the event channel's auto-reject).
   */
  _predictFromSim(seq: number, payload: T, acked?: () => number): void;
}

/**
 * Depth of rollback replay currently executing (module-wide). Replay loops are
 * synchronous and never interleave across controllers, so a simple counter is
 * exact. Backstop for event channels: `channel.predict(...)` called from inside
 * a replayed step (instead of the blessed `ctx.predict`) can detect the replay
 * and no-op rather than re-fire feedback.
 */
let replayDepth = 0;

/** Is a rollback replay executing right now? @see replayDepth */
export function isReplaying(): boolean { return replayDepth > 0; }

/**
 * Options shared by every rollback controller ({@link Reconciler},
 * `SimReconciler`) — the observed input channel, the fixed-step trio, and the
 * reconcile telemetry hooks. Each controller extends this with its own
 * state-shape options (`fields` / `world` + `adopt`/`pose`) and its own `step`
 * signature.
 */
export interface RollbackOptions<I> {
    /**
     * The input channel to OBSERVE (`room.input(...)`). You mutate + send through
     * the handle directly (`input.data.x = …; input.send()`); the controller
     * watches its `sentCount` and steps each new input (predict), and polls
     * `input.lastProcessed` to reconcile. It never stages or sends — the handle is
     * the single way to mutate and send input.
     *
     * Every `send()` transmits one input (body-less when unchanged, never
     * suppressed), so the predicted set always equals the server-applied set (no
     * backdrift). Nothing to configure — the default `room.input()` behavior.
     */
    input: InputHandle<I>;
    /**
     * Server-synced clock resolving {@link StepContext.reckonTime}'s fallback
     * (`serverNow()` for unstamped seqs). Injected automatically by
     * `predict.reconciler()` / `predict.sim()` (the owning Predict's clock —
     * `room.clock`); pass explicitly only for bare construction. Absent ⇒
     * unstamped seqs read `ctx.reckonTime === 0` / `lagCompActive === false`.
     */
    clock?: { serverNow(): number };
    /**
     * Error-decay time constant in ms — the reconcile delta eases out ~63%
     * per `smoothMs` (see {@link SmoothingOptions.smoothMs}). 0 = hard snap.
     * Defaults to the server's correction cadence (`input.patchRate`, one
     * patch interval) so a correction fades before the next one lands —
     * else 50.
     */
    smoothMs?: number;
    /**
     * Teleport threshold (world/pose units). When a reconcile's max per-field
     * |correction| exceeds it, the visual offsets POP to the corrected pose
     * (error zeroed, interpolation re-seeded) instead of decaying out — the
     * active-controller mirror of the passive `attachAll` `snap:`: past the
     * threshold the jump is a discontinuity (teleport / respawn), not an error
     * to glide across the map. All-or-nothing over the smoothed fields — a
     * teleport is one event, one cut; popping per field would tear the pose.
     * Offsets-only: pending inputs still replay from the new truth (correct
     * rollback). A respawn that lands on the SAME position induces zero
     * correction and never trips it — it doesn't need to. Size it above
     * `maxSpeed × patch interval` and below the smallest legitimate teleport.
     * `0`/unset = off (every correction smooths). For discontinuities with no
     * positional jump, call `reset()` instead.
     */
    snap?: number;
    /**
     * Fixed simulation timestep (ms). One input is produced + predicted per step,
     * so the input rate is tied to this, NOT the frame rate — a 120fps and a 60fps
     * client emit the same number of inputs. The owning `Predict` reads this to
     * pace `predict.tick(now)` (which returns how many fixed steps are due).
     * Defaults to the input handle's server-advertised `stepMs` (`1000/tickRate`).
     * REQUIRED (via this or the handle's advertised rate): the controller throws
     * if the fixed step can't be determined, since a wrong `dt` silently diverges
     * rollback-replay. Pass explicitly only when the prediction step differs from
     * the input rate.
     */
    stepMs?: number;
    /**
     * The fixed step in SECONDS used for {@link StepContext.dt} — the dt your
     * `step` integrates with. MUST equal the server's per-step dt (`1/tickRate`)
     * for rollback-replay to reproduce the server. Defaults to the input handle's
     * `input.stepSeconds` (the server's exact `1/tickRate`); else `stepMs / 1000`
     * (which can be 1 ULP off at some rates). Pass explicitly only to override.
     */
    stepSeconds?: number;
    /**
     * Physics sub-steps per fixed step for {@link StepContext.subSteps} /
     * {@link StepContext.subDt} (integer ≥ 1). MUST equal the server's count for
     * replay to reproduce its trajectory. Defaults to the input handle's
     * server-advertised `input.subSteps` (from `setFixedTimestep(..., { subSteps
     * })`) — pass explicitly only to override.
     */
    subSteps?: number;
    /**
     * Called at the end of each reconcile with the just-acked seq, after the
     * authoritative state is adopted and unacked inputs replayed. For state the
     * controller doesn't own — adopting server hit/invuln, pruning per-seq
     * side-effect records, etc.
     */
    onReconcile?: (acked: number) => void;
    /**
     * Dev diagnostic: when set, `console.warn` (throttled to ~1/s) whenever a
     * reconcile's max |correction| exceeds this tolerance (world/pose units),
     * naming the input seq, the worst field + its delta, and the usual cause. The
     * reconcile correction already IS the client-vs-server divergence, so this
     * costs no extra wire traffic. Leave unset (the default) in production.
     */
    warnOnDivergence?: number;
}

/** Reused per-step context — mutated in place each step, no per-step alloc.
 *  `dt`/`dtMs`/sub-step trio are constant; `tick`/`isReplay`/`reckonTime`/
 *  `lagCompActive` change. `memo` is bound once and reads the live
 *  `tick`/`isReplay` at call time. */
interface MutableStepContext {
    dt: number; dtMs: number; tick: number; isReplay: boolean; reckonTime: number;
    lagCompActive: boolean;
    subSteps: number; subDt: number; subDtMs: number;
    memo: <T>(keyOrCompute: string | (() => T), compute?: () => T) => T | undefined;
    predict: <T>(sink: PredictSink<T>, payload: T) => void;
}

/**
 * Shared rollback engine — a pure OBSERVER of an input handle. Owns the ack poll,
 * the reconcile scaffold, smooth error correction, `ctx.memo` memoization, and
 * drift telemetry; subclasses fill the state-shape hooks (see the class header).
 *
 * It never stages or sends: you mutate + send through the handle directly
 * (`input.data.x = …; input.send()`), and the controller — subscribed to the
 * handle's `onSend` — runs your `step` for that input right then (so render reads
 * stay pure). The server ack is the one thing it polls (`input.lastProcessed`, in
 * {@link tick}), since that arrives asynchronously over the network. The parent
 * `Predict` paces the room (`predict.tick(now)` returns how many fixed steps are
 * due); this controller derives its own render interpolation from that same
 * `tick(now)` (see {@link renderAlpha}). Not exported from the package — consumers
 * use {@link Reconciler} / `SimReconciler`.
 */
export abstract class RollbackController<I = any> {
    // --- Debug telemetry (no effect on prediction) ---------------------------
    /** Per-numeric-field correction injected by the most recent reconcile — the
     *  raw pop (rendered-before − corrected), nonzero even in snap mode. Reused
     *  object, overwritten each reconcile; read it right after, don't retain. */
    readonly lastCorrection: Record<string, number> = {};
    /** Max |{@link lastCorrection}| across fields (world/pose units). ~0 ⇒ the
     *  prediction matched the server at the acked input. */
    lastCorrectionMag = 0;
    /** Increments once per reconcile — lets a consumer detect a fresh one
     *  (compare against a stored value) without a callback. */
    reconcileSeq = 0;
    /** Rolling reconcile drift (world/pose units). `ema` = persistent component
     *  (steady nonzero ⇒ divergence / rubber-banding); `peak` = recent decaying
     *  max (a spike over a low `ema` ⇒ network jitter, not divergence). Both ~0 ⇒
     *  the prediction matched the server. Updated once per reconcile. @see Drift */
    readonly drift: Drift = newDrift();

    /** Per-field visual offset decaying toward 0 (numeric/pose fields only). */
    protected readonly error: Record<string, number> = {};
    /** Previous step's SMOOTHED value (`current + error`) — render interpolates
     *  from this by {@link alpha} so motion is smooth above the step rate. */
    protected readonly prev: Record<string, number> = {};
    /** Reused scratch for reconcile's pre-snap rendered values — no per-reconcile alloc. */
    protected readonly renderedBefore: Record<string, number> = {};

    protected lastTick = -1;
    protected lastAcked = 0;
    /** Cached `input.epoch` — {@link tick} self-resets when the handle's epoch
     *  moves (reconnect / `input.reset()`), so the app never wires it manually. */
    private lastEpoch: number;
    /** Seq floor for replay: inputs sent at/before this aren't replayed (they
     *  applied to a prior life — set to the sent count on {@link reset}). The
     *  unacked INPUTS themselves live on the input handle, not here. */
    protected replayFrom = 0;

    /** Highest input seq the LIVE prediction has stepped. Advanced by {@link catchUp}
     *  as the app sends (via the `onSend` hook); reconcile brings it back to
     *  `input.sentCount` after replay. */
    protected predictedSeq = 0;
    /** Re-entrancy guard: a user `step` that reads back a predicted value must not
     *  recurse into {@link catchUp}. */
    private catching = false;
    /** Unsubscribe from the input handle's `onSend` (set in the constructor). */
    private unsubscribeSend: () => void = () => {};
    /** Render interpolation accumulator: real time (ms) past the latest APPLIED
     *  step. `renderAlpha() = clamp(renderAcc / stepMs, 0, 1)`. Advanced by frame
     *  time in {@link tick}, consumed one `stepMs` per applied step in
     *  {@link catchUp}. While stepping keeps up it equals the exact fixed-timestep
     *  leftover (smooth) and stays in `[0, stepMs)`. The consume rule (see
     *  {@link catchUp}) is what makes it robust across all four render regimes —
     *  steady play, LOAD offset, PAUSE, and a tab-in HITCH — with no cap or special
     *  case: it grows freely (alpha just clamps at 1, so a pause HOLDS at the latest
     *  step), and every applied step snaps it back into `[0, stepMs)` so play,
     *  resume, and hitch all render smooth. */
    private renderAcc = 0;

    /** Frame counter (one bump per {@link tick}) — pairs with
     *  {@link clampedReadTick} to catch render reads that precede the frame's
     *  sends (see {@link noteRenderRead}). */
    private tickSeq = 0;
    /** `tickSeq` of the last render read taken while a full step was due but
     *  unapplied (alpha clamped at 1) — armed by {@link noteRenderRead},
     *  checked against the current frame by {@link catchUp}. */
    private clampedReadTick = -1;
    /** One-shot: the read-before-pump warning already fired for this controller. */
    private warnedStaleRead = false;

    protected readonly stepCtx: MutableStepContext;
    /** Ack watermark handed to event sinks with each `ctx.predict` (one shared
     *  closure — no per-emit alloc). @see PredictSink._predictFromSim */
    private readonly ackWatermark = () => this.input_.lastProcessed;
    /** Per-seq memo backing `ctx.memo` — computed live, replayed verbatim, pruned on ack. */
    protected readonly memos = new MemoStore();
    protected readonly smoothMs: number;
    /** Teleport pop threshold — see {@link RollbackOptions.snap}. 0 = off. */
    private readonly snapThreshold: number;
    /** The fixed simulation step (ms) this controller predicts at — read by the
     *  owning `Predict` to pace `predict.tick(now)`. */
    readonly stepMs: number;
    protected readonly input_: InputHandle<I>;
    private readonly onReconcile?: (acked: number) => void;
    /** Divergence-warning tolerance; `undefined` ⇒ off. @see warnOnDivergence */
    private readonly warnTolerance?: number;
    /** Resolves ctx.reckonTime's unstamped fallback. @see RollbackOptions.clock */
    private readonly clock?: { serverNow(): number };

    constructor(opts: RollbackOptions<I>) {
        this.input_ = opts.input;
        this.clock = opts.clock;
        // Default the decay window to the server's correction cadence (τ = one
        // patch interval) so corrections ease out before the next one — no stacking.
        this.smoothMs = opts.smoothMs
            ?? (this.input_.patchRate ? this.input_.patchRate : 50);
        this.snapThreshold = opts.snap ?? 0;
        // Fixed step: prefer an explicit ms, else the handle's server-advertised
        // rate, else derive from an explicit stepSeconds. A wrong dt silently
        // diverges rollback-replay, so we refuse to guess (no 60Hz fallback):
        // the server must advertise a rate (setFixedTimestep/setTimestep) or the
        // caller must pass stepMs/stepSeconds.
        const stepMs = opts.stepMs ?? this.input_.stepMs
            ?? (opts.stepSeconds !== undefined ? opts.stepSeconds * 1000 : undefined);
        if (stepMs === undefined) {
            throw new Error(
                "@colyseus/sdk reconciler: fixed simulation step is unknown. The " +
                "server room must call setFixedTimestep() (or setTimestep()) so the " +
                "input handle advertises a tick rate, or pass stepMs/stepSeconds " +
                "explicitly — a wrong dt silently diverges rollback-replay.",
            );
        }
        this.stepMs = stepMs;
        // ctx.dt: authoritative seconds. Prefer the handle's stepSeconds (server's
        // exact 1/tickRate); fall back to stepMs/1000 (1-ULP off at some rates).
        const dt = opts.stepSeconds ?? this.input_.stepSeconds ?? (stepMs / 1000);
        // subDt = dt/subSteps: same expression as the server's ctx → bit-identical.
        const subSteps = opts.subSteps ?? this.input_.subSteps ?? 1;
        this.stepCtx = {
            dt, dtMs: stepMs, tick: 0, isReplay: false, reckonTime: 0,
            lagCompActive: false,
            subSteps, subDt: dt / subSteps, subDtMs: stepMs / subSteps,
            // key-less form shares one slot per seq ("" — see StepContext.memo)
            memo: (keyOrCompute, compute) => (typeof keyOrCompute === "string"
                ? this.memos.run(this.stepCtx.tick, this.stepCtx.isReplay, keyOrCompute, compute!)
                : this.memos.run(this.stepCtx.tick, this.stepCtx.isReplay, "", keyOrCompute)),
            // live-only by construction: replayed steps re-run the physics, never the event
            predict: (sink, payload) => { if (!this.stepCtx.isReplay) sink._predictFromSim(this.stepCtx.tick, payload, this.ackWatermark); },
        };
        this.onReconcile = opts.onReconcile;
        this.warnTolerance = opts.warnOnDivergence;
        this.lastAcked = this.input_.lastProcessed;
        this.lastEpoch = this.input_.epoch;
        // Only inputs sent AFTER this controller exists are predicted (catch-up
        // starts here); pre-existing sends belong to whatever ran before.
        this.predictedSeq = this.input_.sentCount;
        // OBSERVE the input stream: step our predicted simulation for each input
        // the app sends through the handle. The listener fires synchronously at the
        // end of `input.send()`, so prediction is current right after — reads
        // (`value`/`state`/`pose`) never have to trigger a catch-up. Fires after
        // subclass construction (only on a later send), so the hooks it calls are ready.
        this.unsubscribeSend = this.input_.onSend(() => this.catchUp());
    }

    // --- Shared observe/reconcile loop -----------------------------------------

    /**
     * Advance one render frame (called by the owning `Predict.tick`): stamp the
     * render clock, reconcile if the server acked new input, then decay the
     * smooth-correction error. Live inputs are already stepped (eagerly, via the
     * `onSend` hook), so tick does NOT step them. The interpolation fraction is
     * derived from elapsed render time vs the fixed step (see {@link renderAlpha}),
     * so it holds steady at the latest step when stepping pauses.
     */
    tick(now: number): void {
        this.tickSeq++;   // new frame — see noteRenderRead/catchUp
        const dt = this.lastTick < 0 ? 0 : now - this.lastTick;
        this.lastTick = now;
        // Advance the render interpolation clock by real frame time. Consumed per
        // applied step in catchUp; equals the fixed-step leftover while stepping
        // keeps up, so interpolation is as smooth as a classic accumulator. It just
        // grows when nothing consumes it (a PAUSE) — alpha clamps at 1 so the render
        // HOLDS at the latest step, and catchUp snaps the backlog back on resume.
        if (dt > 0 && this.stepMs > 0) this.renderAcc += dt;

        // Follow the handle's reset (reconnect / `input.reset()`): the epoch moved,
        // so our seq cursors describe a dead seq space — without this, predictedSeq
        // sits above the re-zeroed sentCount and catch-up no-ops (a frozen entity).
        // Must run BEFORE the ack poll: reset() re-syncs lastAcked, so the poll
        // below sees no phantom delta. Compare (not +1) absorbs multiple resets.
        const epoch = this.input_.epoch;
        if (epoch !== this.lastEpoch) {
            this.lastEpoch = epoch;
            this.reset();
        }

        const acked = this.input_.lastProcessed;
        if (acked > this.lastAcked) {
            this.lastAcked = acked;
            this.reconcile(acked);
        }
        this.markDirty();   // render clock advanced → any cached render pose is stale

        if (dt <= 0) return;
        const k = this.smoothMs <= 0 ? 1 : 1 - Math.exp(-dt / this.smoothMs);
        for (const f of this.smoothedFields()) this.error[f] -= this.error[f] * k;
    }

    /**
     * Render interpolation fraction ∈ [0, 1]: how far into the current step interval
     * we are — the {@link renderAcc} leftover over `stepMs`. Eases 0→1 across one
     * step, then CLAMPS at 1 — so when stepping pauses (input gated off on death, a
     * menu, a freeze) the render HOLDS at the latest step instead of sawtoothing
     * back to the previous one. Read by the subclasses' `value`/`pose`.
     */
    protected renderAlpha(): number {
        if (this.stepMs <= 0) return 1;
        const a = this.renderAcc / this.stepMs;
        return a < 0 ? 0 : a > 1 ? 1 : a;
    }

    /**
     * Record a render read (`value`/`pose` — the subclasses call this at the top
     * of theirs). A read taken while a full fixed step is DUE but not yet applied
     * (`renderAcc ≥ stepMs`, alpha clamped at 1) returns a one-step-stale pose; if
     * this frame's `input.send()` calls then arrive AFTER it, the app rendered
     * stale motion — the read-before-pump wiring bug ({@link catchUp} warns once).
     * The correct frame order is: `predict.tick(now)` → send the due inputs →
     * read `value()`/`pose()`. Raw `state`/`world` reads (game logic, hit-reg)
     * don't come through here and are order-independent. Reads made from inside
     * controller-driven user code (a `step` or effect during catch-up/replay) are
     * skipped — they aren't the app's render pass.
     */
    protected noteRenderRead(): void {
        if (this.catching || this.stepMs <= 0 || this.renderAcc < this.stepMs) return;
        this.clampedReadTick = this.tickSeq;
    }

    /**
     * Step every input sent since the last catch-up (predict each, zero-latency).
     * Driven by the input handle's `onSend` hook (subscribed in the constructor),
     * so it runs synchronously at the end of each `input.send()` — normally
     * stepping exactly the one just-sent input. The loop (rather than a single
     * step) makes it robust to a missed notification. Idempotent once caught up.
     */
    protected catchUp(): void {
        const sent = this.input_.sentCount;
        if (this.predictedSeq >= sent || this.catching) return;
        // A render value was read earlier THIS frame at clamped alpha, and the
        // frame's sends are only arriving now — the app rendered a one-step-stale
        // pose (frame jitter becomes visible stutter on fast objects). Warn once.
        if (this.clampedReadTick === this.tickSeq && !this.warnedStaleRead) {
            this.warnedStaleRead = true;
            warnReadBeforePump();
        }
        this.catching = true;
        this.stepCtx.isReplay = false;           // live forward steps
        for (let seq = this.predictedSeq + 1; seq <= sent; seq++) {
            const inp = this.input_.at(seq);
            if (inp !== undefined) {
                // Snapshot the pre-step smoothed value so the render lerps prev →
                // current across this step by `renderAlpha()`.
                this.snapshotPrev();
                this.runStep(seq, inp);          // predict from the round-tripped wire input
                this.refreshRender();
                // Consume one step of the render clock, resyncing it into [0, stepMs)
                // so the interpolation is smooth across every regime:
                //   • steady play: the clock is already < stepMs after each step, so
                //     this leaves the exact fixed-step leftover (both branches skip).
                //   • LOAD offset (reconciler born mid-frame, first tick dt=0 → clock
                //     lags the pacing accumulator): the subtract goes negative → snap
                //     to 0, resyncing instead of drifting out of phase.
                //   • PAUSE / tab-in HITCH (input gated off, so the clock grew for
                //     many frames with no consume): a WHOLE step of lead remains after
                //     the subtract → drop the stale whole-steps (%=), so the resuming
                //     step renders from the real leftover, not a pinned alpha=1.
                this.renderAcc -= this.stepMs;
                if (this.renderAcc < 0) this.renderAcc = 0;
                else if (this.renderAcc >= this.stepMs) this.renderAcc %= this.stepMs;
            }
            this.predictedSeq = seq;
        }
        this.catching = false;
    }

    /**
     * Set the shared step context for `seq` (tick + reckon instant), then let the
     * subclass run the user step. Used by both the live input path and the
     * reconcile replay loop, so the exact same step invocation drives forward and
     * rollback. `isReplay` is set by the caller before this.
     */
    protected runStep(seq: number, input: I): void {
        this.stepCtx.tick = seq;
        // Per-seq stamp when lag-comp stamped this seq (same value live + on
        // every replay); else resolve to the live serverNow() — the fallback
        // every consumer previously hand-wrote. 0 only with no clock (bare tests).
        const raw = this.input_.reckonTimeAt(seq);
        this.stepCtx.lagCompActive = raw > 0;
        this.stepCtx.reckonTime = raw > 0 ? raw
            : this.clock !== undefined ? this.clock.serverNow() : 0;
        this.applyStep(input);
    }

    /**
     * Adopt the authoritative state and replay unacked inputs. Captures the
     * rendered pose first, adopts truth, replays the still-unacked inputs, then
     * re-bases the error so the rendered pose is UNCHANGED at this instant — the
     * correction then decays out via {@link tick}, hiding the pop.
     *
     * WIRE-PRECISION SHORT-CIRCUIT: when {@link truthMatchesAt} reports the
     * prediction at `acked` is wire-indistinguishable from the decoded truth,
     * adopt+replay are SKIPPED and the client keeps its own (full-precision)
     * state. This is what makes lossy wire types (float32 / auto `number`)
     * safe for reconciled fields: adopting a rounded truth over a correct
     * prediction injects rounding noise into the restore point, and at a
     * knife-edge sim branch (a grounded check, a step-up test) that epsilon
     * flips the branch — a real mispredict born from the wire, not the sim.
     * Skipping is also the fast path: a clean reconcile costs one per-field
     * compare instead of adopt + replay × pending. Ack bookkeeping still runs
     * (memo prune, `onReconcile`, zero-correction telemetry).
     */
    protected reconcile(acked: number): void {
        // Drift telemetry runs only when watched — `warnOnDivergence` set or the
        // debug bundle loaded — so production that uses neither pays nothing.
        const diag = this.warnTolerance !== undefined || diagnosticsActive();

        if (this.truthMatchesAt(acked)) {
            if (diag) {
                for (const f of this.smoothedFields()) this.lastCorrection[f] = 0;
                this.lastCorrectionMag = 0;
                updateDrift(this.drift, 0);   // a perfect reconcile — decay the rolling drift
            }
            this.reconcileSeq++;
            this.memos.prune(acked);
            this.onReconcile?.(acked);
            return;
        }

        // Smoothed value before reconcile (NON-interpolated): keeping `prev`
        // intact lets step-smoothing continue, and a prediction that MATCHED the
        // server induces ZERO new correction (error stays 0).
        const renderedBefore = this.renderedBefore;   // reused scratch (no per-reconcile alloc)
        for (const f of this.smoothedFields()) renderedBefore[f] = this.readCurrent(f) + this.error[f];

        this.adoptTruth();

        // Replay still-unacked inputs from the handle's buffer (controller keeps
        // no copies). Skip anything sent at/before the last reset — it applied to
        // a prior life (respawn) and must not re-run.
        const from = Math.max(acked, this.replayFrom);
        this.stepCtx.isReplay = true;            // rollback re-sim of buffered inputs
        this.catching = true;   // guard: replay-driven user code isn't a render pass, and must not recurse
        replayDepth++;          // backstop for channel.predict() called without ctx (see isReplaying)
        try {
            for (let seq = from + 1; seq <= this.input_.sentCount; seq++) {
                const inp = this.input_.at(seq);
                if (inp !== undefined) this.runStep(seq, inp);
            }
        } finally {
            replayDepth--;
        }
        this.catching = false;
        this.refreshRender();
        // Replay reconstructed the predicted state up to the latest send, so the
        // live cursor is now current — subsequent catch-up has nothing to do.
        this.predictedSeq = this.input_.sentCount;

        // Re-base `error` so the smoothed value is unchanged at this instant, then
        // decays out via tick(). `prev` untouched (interpolation keeps flowing).
        // The raw correction (pre-smoothing pop) doubles as a debug gauge —
        // recorded regardless of smoothing mode so telemetry sees it either way.
        // The `error` rebase below is the REAL reconciliation and always runs.
        const hard = this.smoothMs <= 0;
        const wantMag = diag || this.snapThreshold > 0;
        let mag = 0;
        for (const f of this.smoothedFields()) {
            const correction = renderedBefore[f] - this.readCurrent(f);
            this.error[f] = hard ? 0 : correction;
            if (wantMag) {
                const a = correction < 0 ? -correction : correction;
                if (a > mag) mag = a;
            }
            if (diag) this.lastCorrection[f] = correction;
        }
        // Past the snap threshold the correction is a TELEPORT, not an error: pop
        // every smoothed field to the corrected pose (see RollbackOptions.snap).
        // `prev` must re-seed too — zeroing `error` alone still lerps one render
        // step from the pre-jump pose (a one-frame glide across the map).
        const popped = this.snapThreshold > 0 && mag > this.snapThreshold;
        if (popped) {
            for (const f of this.smoothedFields()) {
                this.error[f] = 0;
                this.prev[f] = this.readCurrent(f);
            }
        }
        this.reconcileSeq++;
        if (diag) {
            this.lastCorrectionMag = mag;
            // A detected teleport is not divergence — feeding it to the drift EMA
            // would false-fire warnOnDivergence on every respawn.
            if (!popped) {
                updateDrift(this.drift, mag);
                if (this.warnTolerance !== undefined && classifyDrift(this.drift, this.warnTolerance) === "diverging") {
                    warnDivergence(acked, this.lastCorrection, this.drift.ema, this.warnTolerance);
                }
            }
        }

        // Drop ctx.memo entries for acked seqs (they won't replay again) BEFORE
        // user code — replay only touches seqs > acked, so this never removes a
        // memo a still-pending replay needs.
        this.memos.prune(acked);
        this.onReconcile?.(acked);
    }

    /** Number of unacknowledged inputs currently buffered. */
    get pendingCount(): number {
        return this.input_.pendingCount;
    }

    /**
     * Re-seed local state from the authoritative instance(s): clears the error
     * offsets, memos, and the in-flight window (prior-life sends won't replay).
     *
     * Mostly the library's job: the controller self-resets when the input handle
     * resets (reconnect / `input.reset()` — it polls `input.epoch`), and a
     * {@link RollbackOptions.snap} threshold pops big positional jumps
     * (teleport / respawn) with no reset at all. Call this yourself only for
     * discontinuities the library can't see: a schema field changed meaning with
     * no positional jump and no input flow (a round flip in a backgrounded tab),
     * app-side context went stale (a map swap), or in-flight inputs the app
     * knows are void (death).
     */
    reset(): void {
        this.reseedState();
        resetDrift(this.drift);   // fresh life — don't carry the prior life's drift
        // Forget in-flight inputs from the prior life — don't replay or re-step them.
        this.replayFrom = this.input_.sentCount;
        this.predictedSeq = this.input_.sentCount;
        this.lastAcked = this.input_.lastProcessed;
        this.renderAcc = 0;   // fresh life renders at the reseeded state (alpha 0)
        this.memos.clear();   // prior life's memoized values must not replay
        this.markDirty();
    }

    /** Set when {@link dispose} is called — the owning Predict drops a `dead`
     *  child from its drive list on the next tick. */
    dead = false;

    /** Teardown hooks run synchronously by {@link dispose} (after `dead` is
     *  set) — the owning Predict restores its `value()` overlay here, so bound
     *  reads fall back the instant the controller dies, not a tick later. */
    private disposedHooks: Array<() => void> = [];

    /** Register a teardown hook for {@link dispose}. Idempotent-safe: hooks run
     *  once (the list is drained). */
    onDisposed(hook: () => void): void { this.disposedHooks.push(hook); }

    /** Stop being driven by the owning Predict and unsubscribe from the input
     *  handle's sends. Runs {@link onDisposed} hooks synchronously. */
    dispose(): void {
        this.dead = true;
        this.unsubscribeSend();
        for (const hook of this.disposedHooks.splice(0)) hook();
    }

    // --- Subclass hooks --------------------------------------------------------

    /** The numeric fields that get smooth error correction (Reconciler's numeric
     *  `fields`, SimReconciler's pose fields). */
    protected abstract smoothedFields(): readonly string[];
    /** Current predicted value of one smoothed field (`local[f]` / `curPose[f]`). */
    protected abstract readCurrent(field: string): number;
    /** Seed the server's authoritative truth into the predicted state, BEFORE the
     *  unacked inputs are replayed on top of it. */
    protected abstract adoptTruth(): void;
    /** Run the user `step` for one buffered input (live or replay). The shared
     *  {@link runStep} has already set `stepCtx.tick`/`reckonTime`; `isReplay` is
     *  set by the caller. */
    protected abstract applyStep(input: I): void;
    /** Snapshot the pre-step SMOOTHED value into `prev` so a subsequent live step
     *  interpolates from it by {@link renderAlpha}. Called once before each live
     *  catch-up step (Reconciler reads `local + error`; SimReconciler `curPose + error`). */
    protected abstract snapshotPrev(): void;
    /** Re-seed local state from the authoritative instance(s) on a hard reset. */
    protected abstract reseedState(): void;
    /**
     * Is the prediction AT the acked seq wire-indistinguishable from the decoded
     * authoritative truth? `true` short-circuits {@link reconcile} (no adopt, no
     * replay — the client's own full-precision state stands). Requires per-seq
     * predicted-state history plus knowledge of each field's wire precision, so
     * only the flat `Reconciler` implements it (its truth is a declared `fields`
     * list on one schema instance); `SimReconciler` can't see through its
     * `adopt`/`pose` closures and inherits this default.
     */
    protected truthMatchesAt(_acked: number): boolean { return false; }

    /** Refresh any derived render state after a step (SimReconciler re-samples its
     *  pose). Called after each live catch-up step and once after reconcile replay.
     *  Default no-op (the flat Reconciler mutates its state in place). */
    protected refreshRender(): void {}
    /** Invalidate any cached render pose after state/alpha changes. Default no-op
     *  (the flat Reconciler recomputes `value()` on read). */
    protected markDirty(): void {}
}

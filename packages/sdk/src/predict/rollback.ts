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
 * correction, `ctx.effect` memoization, drift telemetry — is identical and lives here.
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
import { warnDivergence, diagnosticsActive } from "./divergence.ts";

/**
 * Per-seq memo backing {@link StepContext.effect}: run a closure ONCE on the
 * live step, freeze its result keyed by `(seq, key)`, and on every rollback
 * REPLAY of that seq return the frozen value WITHOUT re-running it. Pruned when
 * the seq is acked, cleared on reset. Shared by {@link Reconciler} and
 * `SimReconciler` (both replay the same per-seq input buffer the same way).
 *
 * Storage is sparse — only seqs that recorded ≥1 effect get an entry — so it
 * stays as small as the hand-rolled per-seq Maps it replaces.
 */
class EffectStore {
    /** seq → (key → memoized value). */
    private byTick = new Map<number, Map<string, any>>();

    /**
     * LIVE (`isReplay=false`): run `compute`, memoize a non-`undefined` result
     * under `(tick, key)`, return it. REPLAY (`isReplay=true`): return the memo
     * (or `undefined` if the live step recorded none) WITHOUT running `compute`.
     */
    run<T>(tick: number, isReplay: boolean, key: string, compute: () => T): T | undefined {
        if (isReplay) return this.byTick.get(tick)?.get(key) as T | undefined;
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

    clear(): void { this.byTick.clear(); }
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
   * But one-shot SIDE EFFECTS — a sound, a particle/VFX, haptics, analytics, a
   * sent message — must fire exactly once: gate them on `!ctx.isReplay`, else
   * they re-fire on every rollback. (This is the standard re-simulation flag
   * rollback netcode exposes so one-shot effects fire only on the first,
   * authoritative pass — but prefer `ctx.effect` below, which handles it for you.)
   *
   * Alternative: keep side effects out of `step` entirely and run them on the
   * live path (in your per-frame loop), as this project does with collision
   * prediction — then you never touch this flag.
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
   * `0` when reckon lag-comp isn't enabled (the room never rewinds to it) or
   * before the clock syncs — fall back to `serverNow()` then, mirroring the
   * server's `reckonTime > 0 ? reckonTime : now`.
   */
  readonly reckonTime: number;
  /**
   * Record a non-derivable effect on the rollback timeline. `compute` runs
   * exactly ONCE — on the LIVE step for this seq — and its result is memoized
   * under `key`; on every rollback REPLAY of this seq the memo is returned and
   * `compute` is NOT re-run. Auto-pruned when the seq is acked, cleared on
   * `reset()`.
   *
   * The blessed alternative to hand-branching on {@link isReplay}. Two shapes:
   *   - **Recorded value** — USE the return (re-applied every replay). For an
   *     outcome replay can't recompute: a lag-comp'd collision velocity, an RNG
   *     roll, a server-assigned id. `const hit = ctx.effect("collide", () =>
   *     collide(state, ctx.reckonTime)); if (hit) state.vx = hit.vx;`
   *   - **Fire-once side-effect** — IGNORE the return; `compute` simply doesn't
   *     re-run on replay. For a sound, particle, flag, analytics ping:
   *     `ctx.effect("bounce", () => { sound.play(); });`
   *
   * `compute` should return `undefined` for "no effect this seq" (stored
   * sparsely — costs nothing). `key` disambiguates >1 effect in one step; call
   * `effect(key, …)` for a given key on EVERY step (let `compute` decide the
   * value) rather than conditionally, so replay sees the same call shape.
   *
   * Prefer reconciled `fields` when the value IS derivable by re-running the
   * step (sync it, both sides simulate it) — that replays AND self-corrects for
   * free. Reach for `effect` only when it genuinely can't be re-derived, and
   * NEVER reconstruct such a value via an `input.at(seq)` lookback (it ages out
   * the moment the seq is acked — the snap-back this primitive exists to prevent).
   */
  effect<T>(key: string, compute: () => T): T | undefined;
}

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
     * Error-decay rate (spring constant 1/s; higher = snappier). The reconcile
     * delta eases to zero at this rate. 0 = hard snap. Defaults to the server's
     * correction cadence (`input.patchRate`) so the error decays over ~one patch
     * interval — else 20.
     */
    smoothing?: number;
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
 *  `dt`/`dtMs`/sub-step trio are constant; `tick`/`isReplay`/`reckonTime` change.
 *  `effect` is bound once and reads the live `tick`/`isReplay` at call time. */
interface MutableStepContext {
    dt: number; dtMs: number; tick: number; isReplay: boolean; reckonTime: number;
    subSteps: number; subDt: number; subDtMs: number;
    effect: <T>(key: string, compute: () => T) => T | undefined;
}

/**
 * Shared rollback engine — a pure OBSERVER of an input handle. Owns the ack poll,
 * the reconcile scaffold, smooth error correction, `ctx.effect` memoization, and
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

    protected readonly stepCtx: MutableStepContext;
    /** Per-seq memo backing `ctx.effect` — recorded live, replayed verbatim, pruned on ack. */
    protected readonly effects = new EffectStore();
    protected readonly smoothing: number;
    /** The fixed simulation step (ms) this controller predicts at — read by the
     *  owning `Predict` to pace `predict.tick(now)`. */
    readonly stepMs: number;
    protected readonly input_: InputHandle<I>;
    private readonly onReconcile?: (acked: number) => void;
    /** Divergence-warning tolerance; `undefined` ⇒ off. @see warnOnDivergence */
    private readonly warnTolerance?: number;

    constructor(opts: RollbackOptions<I>) {
        this.input_ = opts.input;
        // Default decay rate to the server's correction cadence (τ = one patch
        // interval) so corrections ease out before the next one — no stacking.
        this.smoothing = opts.smoothing
            ?? (this.input_.patchRate ? 1000 / this.input_.patchRate : 20);
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
            subSteps, subDt: dt / subSteps, subDtMs: stepMs / subSteps,
            effect: (key, compute) => this.effects.run(this.stepCtx.tick, this.stepCtx.isReplay, key, compute),
        };
        this.onReconcile = opts.onReconcile;
        this.warnTolerance = opts.warnOnDivergence;
        this.lastAcked = this.input_.lastProcessed;
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
        const dt = this.lastTick < 0 ? 0 : now - this.lastTick;
        this.lastTick = now;
        // Advance the render interpolation clock by real frame time. Consumed per
        // applied step in catchUp; equals the fixed-step leftover while stepping
        // keeps up, so interpolation is as smooth as a classic accumulator. It just
        // grows when nothing consumes it (a PAUSE) — alpha clamps at 1 so the render
        // HOLDS at the latest step, and catchUp snaps the backlog back on resume.
        if (dt > 0 && this.stepMs > 0) this.renderAcc += dt;

        const acked = this.input_.lastProcessed;
        if (acked > this.lastAcked) {
            this.lastAcked = acked;
            this.reconcile(acked);
        }
        this.markDirty();   // render clock advanced → any cached render pose is stale

        if (dt <= 0) return;
        const k = this.smoothing <= 0 ? 1 : 1 - Math.exp(-this.smoothing * dt / 1000);
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
     * Step every input sent since the last catch-up (predict each, zero-latency).
     * Driven by the input handle's `onSend` hook (subscribed in the constructor),
     * so it runs synchronously at the end of each `input.send()` — normally
     * stepping exactly the one just-sent input. The loop (rather than a single
     * step) makes it robust to a missed notification. Idempotent once caught up.
     */
    protected catchUp(): void {
        const sent = this.input_.sentCount;
        if (this.predictedSeq >= sent || this.catching) return;
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
        this.stepCtx.reckonTime = this.input_.reckonTimeAt(seq); // same per-seq value live + on replay
        this.applyStep(input);
    }

    /**
     * Adopt the authoritative state and replay unacked inputs. Captures the
     * rendered pose first, adopts truth, replays the still-unacked inputs, then
     * re-bases the error so the rendered pose is UNCHANGED at this instant — the
     * correction then decays out via {@link tick}, hiding the pop.
     */
    protected reconcile(acked: number): void {
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
        for (let seq = from + 1; seq <= this.input_.sentCount; seq++) {
            const inp = this.input_.at(seq);
            if (inp !== undefined) this.runStep(seq, inp);
        }
        this.refreshRender();
        // Replay reconstructed the predicted state up to the latest send, so the
        // live cursor is now current — subsequent catch-up has nothing to do.
        this.predictedSeq = this.input_.sentCount;

        // Re-base `error` so the smoothed value is unchanged at this instant, then
        // decays out via tick(). `prev` untouched (interpolation keeps flowing).
        // The raw correction (pre-smoothing pop) doubles as a debug gauge —
        // recorded regardless of snap mode so telemetry sees it either way. Drift
        // telemetry runs only when watched — `warnOnDivergence` set or the debug
        // bundle loaded — so production that uses neither pays nothing. The `error`
        // rebase below is the REAL reconciliation and always runs.
        const diag = this.warnTolerance !== undefined || diagnosticsActive();
        const snap = this.smoothing <= 0;
        let mag = 0;
        for (const f of this.smoothedFields()) {
            const correction = renderedBefore[f] - this.readCurrent(f);
            this.error[f] = snap ? 0 : correction;
            if (diag) {
                this.lastCorrection[f] = correction;
                const a = correction < 0 ? -correction : correction;
                if (a > mag) mag = a;
            }
        }
        this.reconcileSeq++;
        if (diag) {
            this.lastCorrectionMag = mag;
            updateDrift(this.drift, mag);
            if (this.warnTolerance !== undefined && classifyDrift(this.drift, this.warnTolerance) === "diverging") {
                warnDivergence(acked, this.lastCorrection, this.drift.ema, this.warnTolerance);
            }
        }

        // Drop ctx.effect memos for acked seqs (they won't replay again) BEFORE
        // user code — replay only touches seqs > acked, so this never removes a
        // memo a still-pending replay needs.
        this.effects.prune(acked);
        this.onReconcile?.(acked);
    }

    /** Number of unacknowledged inputs currently buffered. */
    get pendingCount(): number {
        return this.input_.pendingCount;
    }

    /** Re-seed local state from the authoritative instance(s) and clear the
     *  error offset + input buffer. For respawns / hard resyncs. */
    reset(): void {
        this.reseedState();
        resetDrift(this.drift);   // fresh life — don't carry the prior life's drift
        // Forget in-flight inputs from the prior life — don't replay or re-step them.
        this.replayFrom = this.input_.sentCount;
        this.predictedSeq = this.input_.sentCount;
        this.lastAcked = this.input_.lastProcessed;
        this.renderAcc = 0;   // fresh life renders at the reseeded state (alpha 0)
        this.effects.clear();   // prior life's recorded effects must not replay
        this.markDirty();
    }

    /** Set when {@link dispose} is called — the owning Predict drops a `dead`
     *  child from its drive list on the next tick. */
    dead = false;

    /** Stop being driven by the owning Predict and unsubscribe from the input
     *  handle's sends. */
    dispose(): void { this.dead = true; this.unsubscribeSend(); }

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
    /** Refresh any derived render state after a step (SimReconciler re-samples its
     *  pose). Called after each live catch-up step and once after reconcile replay.
     *  Default no-op (the flat Reconciler mutates its state in place). */
    protected refreshRender(): void {}
    /** Invalidate any cached render pose after state/alpha changes. Default no-op
     *  (the flat Reconciler recomputes `value()` on read). */
    protected markDirty(): void {}
}

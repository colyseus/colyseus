/**
 * SimReconciler — server-reconciled rollback for the entity (or entities) your
 * inputs control, when their authoritative truth isn't a single flat scalar list.
 *
 * The general counterpart to {@link Reconciler}. Where `Reconciler` mirrors a
 * declared `fields` list off ONE authoritative schema instance, `SimReconciler`
 * orchestrates the same rollback loop over whatever your inputs affect:
 *   - **composite scalar state** — several schema instances stepped together by a
 *     shared plain-math sim (e.g. `{ paddle, puck }`: your paddle by input, the puck
 *     it bounces, reconciled as one), or
 *   - **opaque engine state** — a physics solver (Rapier, crashcat, …) whose truth
 *     (contacts, velocities, sub-bodies) is far more than a handful of numbers.
 *
 * Either way the controller never names the fields: YOUR `world` owns the state and
 * the SDK only runs the loop — predict-immediately, buffer unacked inputs, and on the
 * server ack adopt truth and replay — through three callbacks (`step`, `adopt`,
 * `pose`). The `world` handle is passed to every callback rather than closed over, so
 * the same callbacks port cleanly to C# / C / Lua (no captured references to marshal).
 *
 * Reconcile restores authoritative truth via {@link SimReconcilerOptions.adopt}: seed
 * your `world` from the authoritative scalars on the schema, then replay the still-
 * unacked inputs on top. For composite state, `adopt` overwrites each source's scalars
 * (paddle x/y, puck x/y/vx/vy); for an engine it reseeds the body (translation +
 * velocity). One restore path, no snapshot ring.
 *
 * > **Tradeoff:** `adopt` reseeds the SCALARS you copy and replay reproduces the rest.
 * > Engine-INTERNAL non-scalar state (contact caches, sleeping islands, solver
 * > accumulators) is NOT rolled back across reconcile — only what `adopt` restores
 * > plus what replay re-derives. Both shipped consumers (composite scalars; a Rapier
 * > shooter reseeding position+velocity) are well-served by this; an engine that
 * > depends on internal state surviving reconcile would need a per-tick snapshot ring,
 * > which this controller intentionally does not carry.
 *
 * Smooth error correction moves to the RENDER POSE returned by
 * {@link SimReconcilerOptions.pose} (a record of numbers): a misprediction is absorbed
 * into a per-pose-field visual offset that decays to 0 over a few frames, so
 * corrections never pop. For non-lerp poses (3D quaternions) pass
 * {@link SimReconcilerOptions.interpolate} — the default is a per-field numeric lerp
 * (translation/scalar only).
 *
 * Fixed-timestep, same shape as `Reconciler`: {@link beginFrame} returns how many
 * `stepMs` steps to run now; the caller loops that many times calling {@link input}
 * (predict + buffer + send) once per step. `predict.tick(now)` drives reconcile +
 * decay. Render reads ({@link value}/{@link pose}) interpolate between the two latest
 * steps so motion stays smooth above the step rate.
 *
 * The lifecycle of the three callbacks — when each fires, keyed to network acks the
 * app never sees directly:
 *
 *     your render frame:
 *                                          ┌─ new ack? ─▶ adopt(world)                adopt server truth
 *       predict.tick(now) ─────────────────┤             step(ctx, cmd, world) × pend  replay, isReplay=true
 *                                          │             pose(world)                   re-sample pose (once)
 *                                          └─ always ──▶ error decay
 *       n = me.beginFrame(frameDt)
 *       n × me.input(cmd) ─────────────────▶             step(ctx, cmd, world)         live, isReplay=false
 *                                                        pose(world)                   sample pose
 *       draw(me.value("x"))                ◀── cached pose: interpolate + smooth, NO callbacks
 *
 * Composite-scalar example (no engine — the common case):
 *
 *     const input = room.input({ type: MoveInput, mode: "reliable" });
 *     const world = {
 *         paddle: { x: player.x, y: player.y },
 *         puck:   { x: s.puck.x, y: s.puck.y, vx: s.puck.vx, vy: s.puck.vy },
 *     };
 *     const me = predict.sim({
 *         input,
 *         world,
 *         step:  (ctx, cmd, w) => stepWorld(w, cmd, ctx.dt),       // SHARED with the server
 *         adopt: (w) => {                                          // server truth, same patch
 *             w.paddle.x = player.x;  w.paddle.y = player.y;
 *             w.puck.x = s.puck.x;    w.puck.y = s.puck.y;
 *             w.puck.vx = s.puck.vx;  w.puck.vy = s.puck.vy;
 *         },
 *         pose:  (w) => ({ x: w.paddle.x, y: w.paddle.y, puckX: w.puck.x, puckY: w.puck.y }),
 *     });
 *     const n = me.beginFrame(frameDtMs);
 *     for (let i = 0; i < n; i++) me.input(sampleInput());         // predict + buffer + send
 *     draw(me.value("x"), me.value("puckX"));                      // flat pose key — no path eval
 *
 * Engine-backed example (Rapier — the `world` handle reaches the solver + body):
 *
 *     const me = predict.sim({
 *         input,
 *         world: { world, body },                                  // the engine handle
 *         step:  (ctx, cmd, w) => { applyInput(w.body, cmd); w.world.step(); }, // dt = ctx.dt
 *         adopt: (w) => { w.body.setTranslation({ x: self.x, y: self.y }, true); },
 *         pose:  (w) => { const t = w.body.translation(); return { x: t.x, y: t.y }; },
 *     });
 */

// Drives + reads acks through `room.input(...)`'s handle (type-only, erased).
import type { InputHandle } from "../input/InputHandle.ts";
// Shared fixed-step context — ONE `dt` drives both sides of the rollback.
import type { StepContext } from "./reconciler.ts";
import { newDrift, updateDrift, resetDrift, classifyDrift, type Drift } from "./drift.ts";
import { warnDivergence, diagnosticsActive } from "./divergence.ts";

export interface SimReconcilerOptions<I, P extends Record<string, number>, E> {
    /**
     * The input channel (`room.input(...)`). The controller stages each cmd onto
     * `input.data`, calls `input.send()`, and reads the server ack from
     * `input.lastProcessed` / `input.sentCount`. Every `send()` transmits one
     * input (body-less when unchanged), so EVERY predicted step is delivered
     * (predicted set == server-applied set) — no configuration needed.
     */
    input: InputHandle<I>;
    /**
     * Your world handle — whatever your callbacks need to reach the simulated state.
     * Composite scalars (`{ paddle, puck }`) or an engine handle (`{ world, body }`
     * for Rapier, `{ world, id }` for crashcat). Stored once and passed to every
     * callback; never swapped (no snapshot ring to thread a fresh root through).
     */
    world: E;
    /**
     * Deterministic input-application step, SHARED with the server. Apply `command`
     * to `world` and advance it by `ctx.dt` (the engine's internal timestep MUST
     * equal `ctx.dt` for replay to reproduce the server). `ctx.isReplay` is `true`
     * during rollback re-sim — gate one-shot side effects on `!ctx.isReplay`.
     */
    step: (ctx: StepContext, command: I, world: E) => void;
    /**
     * Adopt the server's authoritative truth into `world`: seed it from the
     * authoritative scalars on your schema instance(s). Called on every server ack,
     * BEFORE the unacked inputs are replayed on top. Close over whatever sources you
     * need — the SDK never reads your schema; you copy from it here. For composite
     * state the whole patch is decoded before the ack is processed, so reading
     * several instances in one `adopt` adopts them all from the same server tick.
     */
    adopt: (world: E) => void;
    /**
     * Read `world` into a render pose — a record of numbers (e.g. `{ x, y }` or
     * `{ x, y, z, qx, qy, qz, qw }`). Called after every step/reconcile; smoothing
     * and interpolation operate on these fields. May return a reused object — the
     * controller copies the numbers out synchronously. The field set is taken from
     * the first call and assumed stable.
     */
    pose: (world: E) => P;
    /**
     * Custom pose interpolation `a → b` by `t ∈ [0,1]`. Required for poses that
     * don't lerp componentwise (quaternions → slerp + renormalize). Default is a
     * per-field numeric lerp. `a`/`b` may be reused scratch — don't retain them.
     */
    interpolate?: (a: P, b: P, t: number) => P;
    /**
     * Error-decay rate (spring constant 1/s; higher = snappier). 0 = hard snap.
     * Defaults to the server's correction cadence (`input.patchRate`) else 20.
     */
    smoothing?: number;
    /**
     * Fixed simulation timestep (ms) for {@link beginFrame}. One input is produced
     * + predicted per step, so the input rate is tied to this, NOT the frame rate.
     * Defaults to the input handle's server-advertised `stepMs` (`1000/tickRate`),
     * else `1000 / 60`.
     */
    stepMs?: number;
    /**
     * The fixed step in SECONDS used for {@link StepContext.dt}. MUST equal the
     * server's per-step dt. Defaults to `input.stepSeconds`; else `stepMs / 1000`.
     */
    stepSeconds?: number;
    /**
     * Physics sub-steps per fixed step for {@link StepContext.subSteps} /
     * {@link StepContext.subDt} (integer ≥ 1): your `step` integrates the world
     * `subSteps` times at `ctx.subDt`, exactly like the server. MUST equal the
     * server's count for replay to reproduce its trajectory. Defaults to the
     * input handle's server-advertised `input.subSteps` — pass explicitly only
     * to override.
     */
    subSteps?: number;
    /**
     * Stage a cmd onto the wire `input.data` before sending. Default copies
     * matching fields (`Object.assign(input.data, cmd)`).
     */
    writeInput?: (data: any, cmd: I) => void;
    /** Called at the end of each reconcile with the just-acked seq. */
    onReconcile?: (acked: number) => void;
    /**
     * Dev diagnostic: when set, `console.warn` (throttled to ~1/s) whenever a
     * reconcile's max |pose correction| exceeds this tolerance (pose units),
     * naming the input seq, the worst pose field + its delta, and the usual
     * cause. Costs no extra wire traffic. Leave unset in production.
     */
    warnOnDivergence?: number;
}

export class SimReconciler<I = any, P extends Record<string, number> = any, E = any> {
    /** Your world handle — set once at construction, passed to every callback,
     *  never swapped (no snapshot ring). */
    private readonly worldHandle: E;

    /** Previous step's SMOOTHED pose (`pose + error`) — render interpolates from
     *  this by {@link alpha} so motion is smooth above the step rate. */
    private readonly prevPose: Record<string, number> = {};
    /** Current step's RAW pose (`pose(world)`), refreshed after every step. */
    private readonly curPose: Record<string, number> = {};
    /** Per-pose-field visual offset decaying toward 0. */
    private readonly error: Record<string, number> = {};
    /** Pose field names, captured from the first {@link readPose}. */
    private poseFields: readonly string[] = [];
    private fieldsReady = false;

    // --- Debug telemetry (no effect on prediction) ---------------------------
    /** Per-pose-field correction injected by the most recent reconcile (rendered
     *  -before − reconciled). Reused object, overwritten each reconcile. */
    readonly lastCorrection: Record<string, number> = {};
    /** Max |correction| across pose fields injected by the most recent reconcile
     *  (pose units). ~0 ⇒ the prediction matched the server at the acked input. */
    lastCorrectionMag = 0;
    /** Increments once per reconcile — detect a fresh one (compare a stored value)
     *  without a callback. */
    reconcileSeq = 0;
    /** Rolling reconcile drift (pose units). `ema` = persistent component (steady
     *  nonzero ⇒ divergence / rubber-banding); `peak` = recent decaying max (a
     *  spike over a low `ema` ⇒ network jitter, not divergence). Both ~0 ⇒ the
     *  prediction matched the server. @see Drift */
    readonly drift: Drift = newDrift();

    private lastTick = -1;
    private lastAcked = 0;
    /** Seq floor for replay: inputs at/before this aren't replayed (prior life). */
    private replayFrom = 0;

    /** Leftover real time (ms) not yet consumed by a fixed step. */
    private acc = 0;
    /** Interpolation fraction into the current step, `acc / stepMs` ∈ [0, 1]. */
    private alpha = 0;
    /** Reused scratch for reconcile's pre-snap rendered pose — no per-reconcile alloc. */
    private readonly renderedBefore: Record<string, number> = {};

    /** Reused scratch for {@link pose}: smoothed prev/cur endpoints + memo. */
    private readonly poseA: Record<string, number> = {};
    private readonly poseB: Record<string, number> = {};
    private readonly renderPose: Record<string, number> = {};
    /** Set whenever the pose endpoints/alpha change; {@link pose} recomputes once. */
    private poseDirty = true;

    private readonly step: (ctx: StepContext, command: I, world: E) => void;
    private readonly adopt: (world: E) => void;
    /** The `pose` option callback, stored under a distinct name so it doesn't
     *  shadow the public {@link pose} method. */
    private readonly readPose: (world: E) => P;
    private readonly interpolate?: (a: P, b: P, t: number) => P;
    /** Reused per-step context — `dt`/`dtMs`/sub-step trio constant; only `tick`/`isReplay` change. */
    private readonly stepCtx: { dt: number; dtMs: number; tick: number; isReplay: boolean; subSteps: number; subDt: number; subDtMs: number };
    private readonly smoothing: number;
    private readonly stepMs: number;
    private readonly onReconcile?: (acked: number) => void;
    /** Divergence-warning tolerance (pose units); `undefined` ⇒ off. @see warnOnDivergence */
    private readonly warnTolerance?: number;
    private readonly input_: InputHandle<I>;
    private readonly writeInput: (data: any, cmd: I) => void;

    /** Spiral-of-death guard: never run more than this many steps per frame. */
    private static readonly MAX_STEPS_PER_UPDATE = 5;

    constructor(opts: SimReconcilerOptions<I, P, E>) {
        this.input_ = opts.input;
        this.worldHandle = opts.world;
        this.step = opts.step;
        this.adopt = opts.adopt;
        this.readPose = opts.pose;
        this.interpolate = opts.interpolate;
        // Decay defaults to the server's correction cadence (τ = one patch interval).
        this.smoothing = opts.smoothing
            ?? (this.input_.patchRate ? 1000 / this.input_.patchRate : 20);
        // Fixed step defaults from the input handle's server-advertised rate.
        this.stepMs = opts.stepMs ?? this.input_.stepMs ?? (1000 / 60);
        const dt = opts.stepSeconds ?? this.input_.stepSeconds ?? (this.stepMs / 1000);
        // subDt = dt/subSteps: same expression as the server's ctx → bit-identical.
        const subSteps = opts.subSteps ?? this.input_.subSteps ?? 1;
        this.stepCtx = {
            dt, dtMs: this.stepMs, tick: 0, isReplay: false,
            subSteps, subDt: dt / subSteps, subDtMs: this.stepMs / subSteps,
        };
        this.onReconcile = opts.onReconcile;
        this.warnTolerance = opts.warnOnDivergence;
        this.writeInput = opts.writeInput ?? ((data, cmd) => Object.assign(data as object, cmd as object));
        this.lastAcked = this.input_.lastProcessed;

        // Seed pose from the world's current state.
        this.refreshPose();
        for (const f of this.poseFields) { this.prevPose[f] = this.curPose[f]; this.error[f] = 0; }
    }

    /** Read the world pose into {@link curPose} (capturing the field set once). */
    private refreshPose(): void {
        const pose = this.readPose(this.worldHandle) as Record<string, number>;
        if (!this.fieldsReady) { this.poseFields = Object.keys(pose); this.fieldsReady = true; }
        for (const f of this.poseFields) this.curPose[f] = pose[f];
        this.poseDirty = true;
    }

    /**
     * Begin a render frame: accumulate the elapsed frame time and return HOW MANY
     * fixed `stepMs` steps to simulate now. The caller loops that many times
     * calling {@link input}. Callback-free by design (returns a count).
     */
    beginFrame(frameDtMs: number): number {
        this.acc += frameDtMs;
        const want = this.stepMs > 0 ? Math.floor(this.acc / this.stepMs) : 0;
        if (want > SimReconciler.MAX_STEPS_PER_UPDATE) {
            // Hitch: run a bounded count, DROP the backlog, snap interpolation.
            this.acc = 0;
            this.alpha = 0;
            this.poseDirty = true;
            return SimReconciler.MAX_STEPS_PER_UPDATE;
        }
        this.acc -= want * this.stepMs;
        this.alpha = this.stepMs > 0 ? this.acc / this.stepMs : 1;
        this.poseDirty = true;
        return want;
    }

    /** The wire input to stage (`input.data`) — mutate fields directly instead of
     *  building a cmd object. */
    get data(): any { return this.input_.data; }

    /** Your world handle (passed to every callback). */
    get world(): E { return this.worldHandle; }

    /**
     * Apply ONE fixed step: stage + transmit the cmd (advancing the handle's
     * `sentCount` → this input's seq), advance the world NOW (zero-latency). Returns
     * the seq.
     */
    input(cmd: I): number {
        // Snapshot pre-step SMOOTHED pose so `value()` lerps prev → current.
        for (const f of this.poseFields) this.prevPose[f] = this.curPose[f] + this.error[f];
        this.writeInput(this.input_.data, cmd); // stage cmd → wire
        this.input_.send();                      // transmit + buffer for replay → sentCount++
        const seq = this.input_.sentCount;
        this.stepCtx.tick = seq;
        this.stepCtx.isReplay = false;           // live forward step
        this.step(this.stepCtx, cmd, this.worldHandle);
        this.refreshPose();
        return seq;
    }

    /**
     * Advance the render clock: reconcile if the server acked new input, then
     * decay the smooth-correction error. MUST be called once per render frame
     * (handled by the owning `Predict.tick`).
     */
    tick(now: number): void {
        const acked = this.input_.lastProcessed;
        if (acked > this.lastAcked) {
            this.lastAcked = acked;
            this.reconcile(acked);
        }

        const dt = this.lastTick < 0 ? 0 : now - this.lastTick;
        this.lastTick = now;
        if (dt <= 0) return;
        const k = this.smoothing <= 0 ? 1 : 1 - Math.exp(-this.smoothing * dt / 1000);
        for (const f of this.poseFields) this.error[f] -= this.error[f] * k;
        this.poseDirty = true;
    }

    /**
     * Adopt the authoritative state and replay unacked inputs. Captures the
     * rendered pose first, seeds truth into the world via {@link adopt}, replays the
     * still-unacked inputs, then re-bases the error so the rendered pose is UNCHANGED
     * at this instant — the correction decays out via {@link tick}, hiding the pop.
     */
    private reconcile(acked: number): void {
        const renderedBefore = this.renderedBefore;   // reused scratch (no per-reconcile alloc)
        for (const f of this.poseFields) renderedBefore[f] = this.curPose[f] + this.error[f];

        // Seed the server's authoritative scalars into the world.
        this.adopt(this.worldHandle);

        // Replay still-unacked inputs from the handle's buffer.
        const from = Math.max(acked, this.replayFrom);
        this.stepCtx.isReplay = true;            // rollback re-sim of buffered inputs
        for (let seq = from + 1; seq <= this.input_.sentCount; seq++) {
            const inp = this.input_.at(seq);
            if (inp !== undefined) {
                this.stepCtx.tick = seq;
                this.step(this.stepCtx, inp, this.worldHandle);
            }
        }

        this.refreshPose();
        // Re-base `error` so the smoothed pose is unchanged at this instant, then
        // decays via tick(). `prevPose` untouched (interpolation keeps flowing).
        // Drift telemetry runs only when watched — `warnOnDivergence` set or the
        // debug bundle loaded — so production that uses neither pays nothing. The
        // `error` rebase below is the REAL reconciliation and always runs.
        const diag = this.warnTolerance !== undefined || diagnosticsActive();
        const snap = this.smoothing <= 0;
        let mag = 0;
        for (const f of this.poseFields) {
            const correction = renderedBefore[f] - this.curPose[f];
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

        this.onReconcile?.(acked);
    }

    /**
     * Rendered value for one pose field: the predicted pose interpolated between
     * the previous and current fixed step by {@link alpha}, plus the decaying
     * correction offset. When a custom {@link SimReconcilerOptions.interpolate}
     * is set, reads it off the interpolated {@link pose}.
     */
    value(field: keyof P & string): number {
        if (this.interpolate) return (this.pose() as Record<string, number>)[field];
        const c = this.curPose[field] + (this.error[field] ?? 0);
        const p = this.prevPose[field] ?? c;
        return p + (c - p) * this.alpha;
    }

    /**
     * The full interpolated + smooth-corrected render pose. Use this (not repeated
     * {@link value} calls) when a custom `interpolate` is set — it's computed once
     * per frame and memoized. The returned record is REUSED — read it synchronously.
     */
    pose(): P {
        if (!this.poseDirty) return this.renderPose as unknown as P;
        const a = this.poseA, b = this.poseB;
        for (const f of this.poseFields) { a[f] = this.prevPose[f] ?? this.curPose[f]; b[f] = this.curPose[f] + (this.error[f] ?? 0); }
        if (this.interpolate) {
            const out = this.interpolate(a as P, b as P, this.alpha) as Record<string, number>;
            for (const f of this.poseFields) this.renderPose[f] = out[f];
        } else {
            for (const f of this.poseFields) this.renderPose[f] = a[f] + (b[f] - a[f]) * this.alpha;
        }
        this.poseDirty = false;
        return this.renderPose as unknown as P;
    }

    /** Number of unacknowledged inputs currently buffered. */
    get pendingCount(): number {
        return this.input_.pendingCount;
    }

    /** Re-seed the world from the authoritative instance(s) and clear the error
     *  offset. For respawns / hard resyncs. */
    reset(): void {
        this.adopt(this.worldHandle);
        this.refreshPose();
        for (const f of this.poseFields) { this.prevPose[f] = this.curPose[f]; this.error[f] = 0; }
        this.acc = 0;
        this.alpha = 0;
        resetDrift(this.drift);   // fresh life — don't carry the prior life's drift
        // Forget in-flight inputs from the prior life — don't replay them.
        this.replayFrom = this.input_.sentCount;
        this.lastAcked = this.input_.lastProcessed;
        this.poseDirty = true;
    }

    /** Set when {@link dispose} is called — the owning Predict drops a `dead`
     *  child from its drive list on the next tick. */
    dead = false;

    /** Stop being driven by the owning Predict (clock-polled, nothing to tear down). */
    dispose(): void { this.dead = true; }
}

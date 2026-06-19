/**
 * Reconciler — server-reconciled rollback for a locally-controlled entity.
 *
 * The active counterpart to {@link Predict}: where Predict passively smooths the
 * server stream for entities you DON'T control (lerp/reckon), the Reconciler
 * owns the predicted simulation of the entity you DO control. It applies your
 * inputs immediately (zero-latency local feel), buffers the unacknowledged
 * ones, and when the server's authoritative state arrives it rewinds to that
 * truth and replays the still-unacked inputs — the same loop as a GGPO
 * rollback, but the *server* is the authority that provides the restore point.
 *
 * The acknowledgement lives on the INPUT HANDLE, not the clock: you send inputs
 * through `room.input(...)`, so that handle is what knows the server ack
 * (`input.lastProcessed`) and the seq you've sent (`input.sentCount`). The
 * reconciler predicts + transmits through the handle and reads the ack off it —
 * send and ack on one object. Reconcile is driven by polling `lastProcessed` in
 * {@link Reconciler.tick} — no schema field, no per-field subscription.
 *
 * Smooth error correction: a misprediction is absorbed into a per-field visual
 * offset (error = renderedBefore − correctedLocal) that decays to 0 over a few
 * frames, so corrections never pop. Correct predictions ⇒ ~zero offset.
 *
 * Input is FIXED-TIMESTEP: {@link beginFrame} accumulates real frame time and
 * returns HOW MANY `stepMs` steps to run now; the caller loops that many times,
 * sampling one input per step into {@link input}. So the input/send rate is tied
 * to the step rate, not the frame rate (a 120fps and a 60fps client emit the
 * same inputs). Render reads ({@link value}) interpolate between the two latest
 * steps so motion stays smooth above the step rate.
 *
 * The step loop is CALLBACK-FREE — a count plus a caller-side loop — so this
 * engine ports to C# / C / Lua by transcription (no closures/function-pointers
 * to marshal); only the loop, input sampling, and transport live in the
 * per-language shell.
 *
 *     // delta:false so EVERY predicted step transmits (predicted set ==
 *     // server-applied set); delta would drop unchanged steps → backdrift.
 *     const input = room.input(MoveInput, { mode: "reliable", delta: false });
 *     const me = predict.reconciler(player, {
 *         input,
 *         step: (ctx, state, command) => applyInput(state, command, LEVEL, ctx.dt), // ctx.dt shared w/ server
 *         fields: ["x", "y", "vx", "vy", "grounded"],
 *         smoothing: 15,
 *         // stepMs / stepSeconds default from `input`'s server-advertised rate.
 *     });
 *
 *     // per frame: how many fixed steps to run, then loop in the shell:
 *     const n = me.beginFrame(frameDtMs);
 *     for (let i = 0; i < n; i++) me.input({ moveX, jump }); // predict + buffer + send
 *     // (predict.tick(now) drives reconcile + decay)
 *     draw(me.value("x"), me.value("y"));                   // interpolated render pose
 *
 * Hot path (`value`) is plain-number only; reconcile (cold, ~server-tick rate)
 * reads the authoritative instance.
 */

// Drives + reads acks through `room.input(...)`'s handle: the input channel +
// input-state owner (staged data, sent buffer, ack). Type-only (erased).
import type { InputHandle } from "../input/InputHandle.ts";

/**
 * Per-step context handed to {@link ReconcilerOptions.step}. Mirrors the
 * server's `StepContext` (@colyseus/core) so ONE fixed `dt` drives both sides of
 * the rollback. Carries only the fixed step — never wall-clock time.
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
   * on top to catch back up — see {@link Reconciler}).
   *
   * Why it matters: one input is replayed 0..N times — once per reconcile until
   * the server acks it (often several frames). Deterministic simulation (your
   * `applyInput`) MUST re-run every time, or replay won't reproduce the server.
   * But one-shot SIDE EFFECTS — a sound, a particle/VFX, haptics, analytics, a
   * sent message — must fire exactly once: gate them on `!ctx.isReplay`, else
   * they re-fire on every rollback. (Same role as Photon Fusion's
   * `IsResimulation` / Quantum's verified-frame flag.)
   *
   * Alternative: keep side effects out of `step` entirely and run them on the
   * live path (in your per-frame loop), as this project does with collision
   * prediction — then you never touch this flag.
   */
  readonly isReplay: boolean;
}

export interface ReconcilerOptions<S extends object, I> {
    /**
     * The input channel (`room.input(...)`). The reconciler stages each cmd onto
     * `input.data`, calls `input.send()`, and reads the server ack from
     * `input.lastProcessed` / `input.sentCount`.
     *
     * Use `{ delta: false }` for continuous per-frame controls: the reconciler
     * predicts one input per `input()`, so every one MUST transmit. `delta: true`
     * suppresses unchanged frames → the client predicts inputs the server never
     * applies → the entity over-predicts and drifts backward on correction.
     *
     * Typed `InputHandle<I>`: the reconciler's command type `I` is the handle's
     * data shape (the controller sets `I = Data<wire>`), so `input.data` and
     * `input.at(seq)` surface as `I` — no `any`. The real `InputHandle<Wire>`
     * assigns covariantly (`Wire` <: `Data<Wire>`).
     */
    input: InputHandle<I>;
    /**
     * Deterministic input-application step, SHARED with the server. Mutates
     * `state` in place by applying `command` over `ctx.dt`. `ctx` leads (matches
     * Quantum/Unreal's step-context-first convention): it carries the fixed `dt`
     * (matches the server's, so replay reproduces the server's result),
     * `ctx.tick` (the input's seq — key per-input side-effects like a collision
     * bounce on it), and `ctx.isReplay` (true during rollback re-sim — gate
     * non-deterministic side effects on `!ctx.isReplay`).
     */
    step: (ctx: StepContext, state: S, command: I) => void;
    /**
     * Fields to mirror from the server on reconcile (everything the step reads
     * or writes). Numeric fields additionally get smooth error correction;
     * non-numeric fields (e.g. `grounded`) are copied verbatim.
     */
    fields: readonly (keyof S & string)[];
    /**
     * Error-decay rate (spring constant 1/s; higher = snappier). The reconcile
     * delta eases to zero at this rate. 0 = hard snap. Defaults to the server's
     * correction cadence (`input.patchRate`) so the error decays over ~one patch
     * interval — else 20.
     */
    smoothing?: number;
    /**
     * Fixed simulation timestep (ms) for {@link Reconciler.beginFrame}. One input
     * is produced + predicted per step, so the input rate is tied to this, NOT the
     * frame rate — a 120fps and a 60fps client emit the same number of inputs.
     * Render reads ({@link Reconciler.value}) interpolate between the two latest
     * steps by the leftover-accumulator fraction, so motion stays smooth above
     * the step rate (at ~one step of render latency). Defaults to the input
     * handle's server-advertised `stepMs` (`1000/tickRate`), else `1000 / 60`.
     * Pass explicitly only when the prediction step differs from the input rate.
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
     * server-advertised `input.subSteps` (from `setFixedTimestep(...,
     * { subSteps })`) — pass explicitly only to override.
     */
    subSteps?: number;
    /**
     * Stage a cmd onto the wire `input.data` before sending. Default copies
     * matching fields (`Object.assign(input.data, cmd)`) — fine when the cmd and
     * wire schema share field names. Override for a custom mapping.
     */
    writeInput?: (data: any, cmd: I) => void;
    /**
     * Called at the end of each reconcile with the just-acked seq, after the
     * authoritative state is adopted and unacked inputs replayed. For state the
     * reconciler doesn't own — adopting server hit/invuln, pruning per-seq
     * side-effect records, etc.
     */
    onReconcile?: (acked: number) => void;
}

export class Reconciler<S extends object = any, I = any> {
    /** The current predicted step state (the "true" state, advanced one fixed
     *  step per input). Read raw for logic; rendered via interpolation. */
    private local: Record<string, number | boolean> = {};
    /** The previous step's SMOOTHED value (`local + error`) — render interpolates
     *  the current smoothed value from this by {@link alpha} so motion is smooth
     *  above the step rate. */
    private prev: Record<string, number> = {};
    /** Per-field visual offset (numeric fields only) decaying toward 0. */
    private error: Record<string, number> = {};

    // --- Debug telemetry (no effect on prediction) ---------------------------
    /** Per-numeric-field correction injected by the most recent reconcile — the
     *  raw pop (rendered-before − corrected), nonzero even in snap mode. Reused
     *  object, overwritten each reconcile; read it right after, don't retain. */
    readonly lastCorrection: Record<string, number> = {};
    /** Max |{@link lastCorrection}| across fields (world units). ~0 ⇒ the
     *  prediction matched the server at the acked input. */
    lastCorrectionMag = 0;
    /** Increments once per reconcile — lets a consumer detect a fresh one
     *  (compare against a stored value) without a callback. */
    reconcileSeq = 0;

    private lastTick = -1;
    private lastAcked = 0;
    /** Seq floor for replay: inputs sent at/before this aren't replayed (they
     *  applied to a prior life — set to the sent count on {@link reset}). The
     *  unacked INPUTS themselves live on the input handle, not here. */
    private replayFrom = 0;

    /** Leftover real time (ms) not yet consumed by a fixed step. */
    private acc = 0;
    /** Interpolation fraction into the current step, `acc / stepMs` ∈ [0, 1]. */
    private alpha = 0;
    /** Reused scratch for reconcile's pre-snap rendered values — overwritten each
     *  reconcile, so no per-reconcile object allocation. */
    private readonly renderedBefore: Record<string, number> = {};

    private readonly fields: readonly string[];
    private readonly numericFields: string[] = [];
    private readonly step: (ctx: StepContext, state: S, command: I) => void;
    /** Reused per-step context — mutated in place each step, no per-step alloc.
     *  `dt`/`dtMs`/sub-step trio are constant; only `tick`/`isReplay` change. */
    private readonly stepCtx: { dt: number; dtMs: number; tick: number; isReplay: boolean; subSteps: number; subDt: number; subDtMs: number };
    private readonly smoothing: number;
    private readonly stepMs: number;
    private readonly onReconcile?: (acked: number) => void;
    private readonly input_: InputHandle<I>;
    private readonly writeInput: (data: any, cmd: I) => void;
    private readonly instance: any;

    /** Spiral-of-death guard: never run more than this many steps per
     *  {@link update} (after a hitch, drop the backlog rather than chasing it). */
    private static readonly MAX_STEPS_PER_UPDATE = 5;

    constructor(instance: object, opts: ReconcilerOptions<S, I>) {
        this.instance = instance;
        this.input_ = opts.input;
        this.fields = opts.fields as readonly string[];
        this.step = opts.step;
        // Default decay rate to the server's correction cadence (τ = one patch
        // interval) so corrections ease out before the next one — no stacking.
        this.smoothing = opts.smoothing
            ?? (this.input_.patchRate ? 1000 / this.input_.patchRate : 20);
        // Default the fixed step from the input handle's server-advertised rate
        // (same pattern as smoothing ← patchRate above) — the handle already
        // carries it, so callers don't pass it twice.
        this.stepMs = opts.stepMs ?? this.input_.stepMs ?? (1000 / 60);
        // ctx.dt: authoritative seconds. Prefer the handle's stepSeconds (server's
        // exact 1/tickRate); fall back to stepMs/1000 (1-ULP off at some rates).
        const dt = opts.stepSeconds ?? this.input_.stepSeconds ?? (this.stepMs / 1000);
        // subDt = dt/subSteps: same expression as the server's ctx → bit-identical.
        const subSteps = opts.subSteps ?? this.input_.subSteps ?? 1;
        this.stepCtx = {
            dt, dtMs: this.stepMs, tick: 0, isReplay: false,
            subSteps, subDt: dt / subSteps, subDtMs: this.stepMs / subSteps,
        };
        this.onReconcile = opts.onReconcile;
        this.writeInput = opts.writeInput ?? ((data, cmd) => Object.assign(data as object, cmd as object));
        this.lastAcked = this.input_.lastProcessed;

        for (const f of this.fields) {
            const v = (instance as Record<string, unknown>)[f];
            this.local[f] = v as number | boolean;
            if (typeof v === "number") { this.numericFields.push(f); this.prev[f] = v; this.error[f] = 0; }
        }
    }

    /**
     * Begin a render frame: accumulate the elapsed frame time and return HOW MANY
     * fixed `stepMs` steps to simulate now (input rate is tied to `stepMs`, NOT
     * the frame rate). The caller (shell) then loops that many times, sampling one
     * input per step and calling {@link input}, plus any per-step game logic. Sets
     * the interpolation {@link alpha} from the leftover accumulator for {@link value}.
     *
     * Callback-FREE by design — returns a count; the loop lives in the caller — so
     * the engine ports to C# / C / Lua by transcription (see the file header).
     */
    beginFrame(frameDtMs: number): number {
        this.acc += frameDtMs;
        const want = this.stepMs > 0 ? Math.floor(this.acc / this.stepMs) : 0;
        if (want > Reconciler.MAX_STEPS_PER_UPDATE) {
            // Hitch: run a bounded count and DROP the backlog rather than spiral;
            // snap interpolation to the latest step (alpha = 0).
            this.acc = 0;
            this.alpha = 0;
            return Reconciler.MAX_STEPS_PER_UPDATE;
        }
        this.acc -= want * this.stepMs;
        this.alpha = this.stepMs > 0 ? this.acc / this.stepMs : 1;
        return want;
    }

    /** The wire input to stage (`input.data`) — exposed so callers can mutate
     *  fields directly instead of building a cmd object. */
    get data(): any { return this.input_.data; }

    /**
     * Apply ONE fixed step: stage the cmd onto the input handle + transmit (which
     * advances the handle's `sentCount` → this input's seq), apply it to the
     * local state NOW (zero-latency), and buffer it for replay until the server
     * acks that seq. Returns the seq. Called once per fixed step by the caller's
     * loop (after {@link beginFrame}).
     */
    input(cmd: I): number {
        // Snapshot pre-step SMOOTHED value so `value()` lerps prev → current
        // across this step by `alpha`.
        for (const f of this.numericFields) this.prev[f] = (this.local[f] as number) + this.error[f];
        this.writeInput(this.input_.data, cmd); // stage cmd → wire
        this.input_.send();                      // transmit + buffer for replay → sentCount++
        const seq = this.input_.sentCount;
        this.stepCtx.tick = seq;
        this.stepCtx.isReplay = false;           // live forward step
        this.step(this.stepCtx, this.local as S, cmd);  // predict (the handle holds the replay copy)
        return seq;
    }

    /**
     * The TRUE predicted state — read it for game logic, and mutate it directly
     * to apply a per-step side-effect (e.g. a collision bounce). It carries no
     * interpolation / smooth-correction offset (that's what {@link value} adds
     * for rendering). To survive a reconcile, a mutation must be reproducible by
     * `step` during replay — record it per-seq and re-apply it inside `step`.
     *
     * Plain object access — no string-keyed get/set, no mutator closure (cf. the
     * old `patch(mutator)` / `raw()`+`set()`). The reconciler tracks ONE entity,
     * so its state is naturally a single struct; this ports to `state.vy = …` in
     * C# / Lua and `state->vy = …` in C (the port exposes it by reference).
     */
    get state(): S {
        return this.local as S;
    }

    /**
     * Advance the render clock: reconcile if the server acked new input, then
     * decay the smooth-correction error. MUST be called once per render frame —
     * it's what drives both reconciliation and the error decay.
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
        for (const f of this.numericFields) this.error[f] -= this.error[f] * k;
    }

    /**
     * Adopt the authoritative state and replay unacked inputs. Captures the
     * rendered pose first, recomputes the predicted pose, then sets the error
     * offset so the rendered pose is UNCHANGED at this instant — the correction
     * then decays out via {@link tick}, hiding the pop.
     */
    private reconcile(acked: number): void {
        // Smoothed value before reconcile (NON-interpolated): keeping `prev`
        // intact lets step-smoothing continue, and a prediction that MATCHED the
        // server induces ZERO new correction (error stays 0).
        const renderedBefore = this.renderedBefore;   // reused scratch (no per-reconcile alloc)
        for (const f of this.numericFields) renderedBefore[f] = (this.local[f] as number) + this.error[f];

        const inst = this.instance as Record<string, number | boolean>;
        for (const f of this.fields) this.local[f] = inst[f];

        // Replay still-unacked inputs from the handle's buffer (reconciler keeps
        // no copies). Skip anything sent at/before the last reset — it applied to
        // a prior life (respawn) and must not re-run.
        const from = Math.max(acked, this.replayFrom);
        this.stepCtx.isReplay = true;            // rollback re-sim of buffered inputs
        for (let seq = from + 1; seq <= this.input_.sentCount; seq++) {
            const inp = this.input_.at(seq);
            if (inp !== undefined) {
                this.stepCtx.tick = seq;
                this.step(this.stepCtx, this.local as S, inp);
            }
        }

        // Re-base `error` so the smoothed value is unchanged at this instant,
        // then decays out via tick(). `prev` untouched (interpolation keeps flowing).
        // The raw correction (pre-smoothing pop) doubles as a debug gauge —
        // recorded regardless of snap mode so telemetry sees it either way.
        const snap = this.smoothing <= 0;
        let mag = 0;
        for (const f of this.numericFields) {
            const correction = renderedBefore[f] - (this.local[f] as number);
            this.lastCorrection[f] = correction;
            this.error[f] = snap ? 0 : correction;
            const a = correction < 0 ? -correction : correction;
            if (a > mag) mag = a;
        }
        this.lastCorrectionMag = mag;
        this.reconcileSeq++;

        this.onReconcile?.(acked);
    }

    /**
     * Rendered value: the predicted state interpolated between the previous and
     * current fixed step by {@link alpha}, plus the decaying correction offset.
     * Smooth above the step rate (at ~one step of render latency). Numeric fields
     * only; non-numeric fields return the current value verbatim.
     */
    value(field: keyof S & string): number {
        const c = this.local[field as string];
        if (typeof c !== "number") return c as unknown as number;
        const smoothed = c + (this.error[field as string] ?? 0);
        const p = this.prev[field as string] ?? smoothed;
        return p + (smoothed - p) * this.alpha;
    }

    /** Number of unacknowledged inputs currently buffered. */
    get pendingCount(): number {
        return this.input_.pendingCount;
    }

    /** Re-seed the local state from the authoritative instance and clear the
     *  error offset + input buffer. For respawns / hard resyncs. */
    reset(): void {
        const inst = this.instance as Record<string, number | boolean>;
        for (const f of this.fields) this.local[f] = inst[f];
        for (const f of this.numericFields) { this.prev[f] = this.local[f] as number; this.error[f] = 0; }
        this.acc = 0;
        this.alpha = 0;
        // Forget in-flight inputs from the prior life — don't replay them.
        this.replayFrom = this.input_.sentCount;
        this.lastAcked = this.input_.lastProcessed;
    }

    /** Set when {@link dispose} is called — the owning Predict drops a `dead`
     *  child from its drive list on the next tick. */
    dead = false;

    /** Stop being driven by the owning Predict. No subscriptions to tear down
     *  (clock-polled), so this just flags the controller dead. */
    dispose(): void { this.dead = true; }
}

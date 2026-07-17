/**
 * Reconciler — server-reconciled rollback for a locally-controlled entity whose
 * authoritative truth is a flat list of scalar `fields` on ONE schema instance.
 *
 * The active counterpart to {@link Predict}: where Predict passively smooths the
 * server stream for entities you DON'T control (lerp/reckon), the Reconciler
 * owns the predicted simulation of the entity you DO control. It applies your
 * inputs immediately (zero-latency local feel), buffers the unacknowledged ones,
 * and when the server's authoritative state arrives rewinds to that truth and
 * replays the still-unacked inputs — the standard rewind-and-replay rollback loop
 * (shared with `SimReconciler` via {@link RollbackController}), with the *server*
 * as the authority that provides the restore point.
 *
 * This is the flat-`fields` face of the shared engine: it mirrors a declared
 * `fields` list off one authoritative schema instance (adopt = copy those fields;
 * pose = read them back). For composite state across several instances, or an
 * opaque physics-engine handle, reach for `SimReconciler` (`predict.sim`).
 *
 * The acknowledgement lives on the INPUT HANDLE, not a clock: you send inputs
 * through `room.input(...)`, so that handle knows the server ack
 * (`input.lastProcessed`) and the seq you've sent (`input.sentCount`).
 *
 * Smooth error correction: a misprediction is absorbed into a per-field visual
 * offset that decays to 0 over a few frames, so corrections never pop.
 *
 * Input is FIXED-TIMESTEP and the reconciler is a pure OBSERVER: you mutate + send
 * through the input handle directly, and `predict.tick(now)` returns how many fixed
 * steps are due this frame. The reconciler watches the handle's `sentCount` and
 * predicts each new send (see {@link RollbackController}); render reads
 * ({@link value}) interpolate between the two latest steps so motion stays smooth
 * above the step rate.
 *
 *     // Every send() transmits one input (body-less when unchanged), so each
 *     // predicted step is delivered — predicted set == server-applied set.
 *     const input = room.input({ type: MoveInput, mode: "reliable" });
 *     const me = predict.reconciler(player, {
 *         input,
 *         step: (ctx, state, command) => applyInput(state, command, LEVEL, ctx.dt), // ctx.dt shared w/ server
 *         fields: ["x", "y", "vx", "vy", "grounded"],
 *         smoothing: 15,
 *         // stepMs / stepSeconds default from `input`'s server-advertised rate.
 *     });
 *
 *     // per frame: predict.tick returns how many fixed input steps are due; mutate
 *     // + send each through the handle — the reconciler observes and predicts them:
 *     const n = predict.tick(now);
 *     for (let i = 0; i < n; i++) {
 *         input.data.moveX = moveX; input.data.jump = jump; // stage the wire input
 *         input.send();                                     // transmit + buffer for replay
 *     }
 *     draw(predict.value(player, "x"), predict.value(player, "y")); // one read idiom
 *
 * The reconciler registers its numeric `fields` into the owning Predict's
 * `predict.value(instance, field)` — the SAME render read as every passively-
 * smoothed entity (raw fallback before spawn / after dispose). `me.value(f)`
 * remains for direct handle reads.
 *
 * Hot path (`value`) is plain-number only; reconcile (cold, ~server-tick rate)
 * reads the authoritative instance.
 */

import { RollbackController, type RollbackOptions, type StepContext } from "./rollback.ts";
import { wireQuantizerOf } from "./schema.ts";

/** Ring/compare encoding of a predicted field value: numbers pass through,
 *  booleans become 0/1, anything else NaN (never matches → safe adopt). The
 *  recording and comparing sides MUST encode identically — hence one helper. */
const asScalar = (v: unknown): number =>
    typeof v === "number" ? v : typeof v === "boolean" ? (v ? 1 : 0) : NaN;

// Re-export StepContext (+ the sink shape its `predict` emits into) so the
// `@colyseus/sdk/predict` barrel resolves them here.
export type { StepContext, PredictSink } from "./rollback.ts";

export interface ReconcilerOptions<S extends object, I> extends RollbackOptions<I> {
    /**
     * Deterministic input-application step, SHARED with the server. Mutates
     * `state` in place by applying `command` over `ctx.dt`. `ctx` leads (the
     * step-context-first argument convention): it carries the fixed `dt`
     * (matches the server's, so replay reproduces the server's result),
     * `ctx.memo` (freeze a value replay can't re-derive) and `ctx.predict`
     * (declare an optimistic event — live steps only, replay-safe).
     *
     * `command` is the buffered wire input the handle recorded at `send()`
     * (`input.at(seq)`) — the exact value the server decodes, read the same way on
     * the live catch-up step and on rollback replay, so lossy wire fields (a
     * `t.quantized` angle) reconcile by construction. Keep everything the step
     * reads on the input schema; anything you don't stage on `input.data` before
     * `send()` won't reach `step`.
     */
    step: (ctx: StepContext, state: S, command: I) => void;
    /**
     * Fields to mirror from the server on reconcile (everything the step reads
     * or writes). Numeric fields additionally get smooth error correction;
     * non-numeric fields (e.g. `grounded`) are copied verbatim.
     */
    fields: readonly (keyof S & string)[];
}

export class Reconciler<S extends object = any, I = any> extends RollbackController<I> {
    /** The current predicted step state (the "true" state, advanced one fixed
     *  step per input). Read raw for logic; rendered via interpolation. */
    private local: Record<string, number | boolean> = {};

    private readonly fields: readonly string[];
    private readonly numericFields: string[] = [];
    private readonly step: (ctx: StepContext, state: S, command: I) => void;
    private readonly instance: any;

    // --- Wire-precision-aware reconcile (see RollbackController.truthMatchesAt) --
    /** Per-field wire quantizer, parallel to `fields`: maps a predicted float64
     *  to the exact value the wire would deliver (fround for `float32`, the
     *  codec's dynamic rule for auto `number`, identity for exact types). */
    private readonly wireRound: Array<(v: number) => number> = [];
    /** Per-seq predicted-state ring (values via {@link asScalar}): slot
     *  `seq % size` holds the post-step field values for that seq; `historySeq`
     *  validates the slot (-1 = empty). Written on every applied step — live AND
     *  replay, so after a rollback the ring tracks the post-rollback trajectory.
     *  Sized to the input handle's replay ring: same seq window, ages out together. */
    private readonly history: Float64Array;
    private readonly historySeq: Float64Array;
    private readonly historySize: number;
    /** False when a declared field isn't a number/boolean at construction (the
     *  ring can't represent it) — the short-circuit is then disabled and every
     *  reconcile adopts, exactly the pre-history behavior. */
    private readonly historyOn: boolean;

    constructor(instance: object, opts: ReconcilerOptions<S, I>) {
        super(opts);
        this.instance = instance;
        this.fields = opts.fields as readonly string[];
        this.step = opts.step;
        let scalarOnly = this.fields.length > 0;
        for (const f of this.fields) {
            const v = (instance as Record<string, unknown>)[f];
            this.local[f] = v as number | boolean;
            if (typeof v === "number") { this.numericFields.push(f); this.prev[f] = v; this.error[f] = 0; }
            else if (typeof v !== "boolean") scalarOnly = false;
            this.wireRound.push(wireQuantizerOf(instance, f));
        }
        this.historyOn = scalarOnly;
        // The 64 fallback covers bare test fakes without a ring.
        this.historySize = this.input_.replayBufferSize ?? 64;
        this.history = new Float64Array(this.historyOn ? this.historySize * this.fields.length : 0);
        this.historySeq = new Float64Array(this.historyOn ? this.historySize : 0).fill(-1);
    }

    /**
     * The TRUE predicted state — read it for game logic, and mutate it directly
     * to apply a per-step side-effect (e.g. a collision bounce). It carries no
     * interpolation / smooth-correction offset (that's what {@link value} adds
     * for rendering). To survive a reconcile, a mutation must be reproducible by
     * `step` during replay — record it per-seq and re-apply it inside `step`.
     *
     * Always current — inputs are stepped eagerly as you `send()` them (the
     * reconciler observes the handle). Plain object access — no string-keyed
     * get/set, no mutator closure. The reconciler tracks ONE entity, so its state
     * is naturally a single struct; this ports to `state.vy = …` in C# / Lua and
     * `state->vy = …` in C.
     */
    get state(): S {
        return this.local as S;
    }

    /** @internal Bound registrations for the owning Predict's `value()` overlay:
     *  this reconciler's numeric fields on its one instance, pose key = field
     *  name ({@link value} already reads by field). Empty source refId (plain
     *  test fixtures) is skipped by the overlay installer. */
    get boundRegistrations(): ReadonlyArray<{ source: object; fields: readonly string[]; poseKeys: readonly string[] }> {
        return [{ source: this.instance as object, fields: this.numericFields, poseKeys: this.numericFields }];
    }

    /**
     * Rendered value: the predicted state interpolated between the previous and
     * current fixed step by {@link renderAlpha}, plus the decaying correction
     * offset. Smooth above the step rate (at ~one step of render latency). Numeric
     * fields only; non-numeric fields return the current value verbatim.
     */
    value(field: keyof S & string): number {
        this.noteRenderRead();
        const c = this.local[field as string];
        if (typeof c !== "number") return c as unknown as number;
        const smoothed = c + (this.error[field as string] ?? 0);
        const p = this.prev[field as string] ?? smoothed;
        return p + (smoothed - p) * this.renderAlpha();
    }

    // --- RollbackController hooks ----------------------------------------------

    protected smoothedFields(): readonly string[] { return this.numericFields; }
    protected readCurrent(field: string): number { return this.local[field] as number; }

    protected applyStep(input: I): void {
        this.step(this.stepCtx, this.local as S, input);
        // Record this seq's predicted state (live and replay alike — after a
        // rollback the replayed values are the canonical prediction).
        if (this.historyOn) {
            const seq = this.stepCtx.tick;
            const slot = seq % this.historySize;
            const base = slot * this.fields.length;
            for (let i = 0; i < this.fields.length; i++) {
                this.history[base + i] = asScalar(this.local[this.fields[i]]);
            }
            this.historySeq[slot] = seq;
        }
    }

    /**
     * Wire-precision compare: the prediction at `acked` (from the history ring)
     * against the decoded truth on the instance, each predicted value passed
     * through its field's wire quantizer. All fields indistinguishable ⇒ the
     * wire could not have told the server anything different ⇒ skip adopt+replay
     * (see {@link RollbackController.reconcile}). Any miss — ring slot aged out
     * or pre-reset, NaN, a genuine mismatch — falls back to a full adopt.
     */
    protected truthMatchesAt(acked: number): boolean {
        if (!this.historyOn) return false;
        const slot = acked % this.historySize;
        if (this.historySeq[slot] !== acked) return false;
        const base = slot * this.fields.length;
        const inst = this.instance as Record<string, unknown>;
        for (let i = 0; i < this.fields.length; i++) {
            if (this.wireRound[i](this.history[base + i]) !== asScalar(inst[this.fields[i]])) return false;
        }
        return true;
    }

    protected snapshotPrev(): void {
        for (const f of this.numericFields) this.prev[f] = (this.local[f] as number) + this.error[f];
    }

    protected adoptTruth(): void {
        const inst = this.instance as Record<string, number | boolean>;
        for (const f of this.fields) this.local[f] = inst[f];
    }

    protected reseedState(): void {
        const inst = this.instance as Record<string, number | boolean>;
        for (const f of this.fields) this.local[f] = inst[f];
        for (const f of this.numericFields) { this.prev[f] = this.local[f] as number; this.error[f] = 0; }
        // Prior life's predictions must not certify a post-reset ack as matching.
        this.historySeq.fill(-1);
    }
}

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
 *     draw(me.value("x"), me.value("y"));                   // interpolated render pose
 *
 * Hot path (`value`) is plain-number only; reconcile (cold, ~server-tick rate)
 * reads the authoritative instance.
 */

import { RollbackController, type RollbackOptions, type StepContext } from "./rollback.ts";

// Re-export StepContext (+ the sink shape its `predict` emits into) so the
// `@colyseus/sdk/predict` barrel resolves them here.
export type { StepContext, PredictSink } from "./rollback.ts";

export interface ReconcilerOptions<S extends object, I> extends RollbackOptions<I> {
    /**
     * Deterministic input-application step, SHARED with the server. Mutates
     * `state` in place by applying `command` over `ctx.dt`. `ctx` leads (the
     * step-context-first argument convention): it carries the fixed `dt`
     * (matches the server's, so replay reproduces the server's result),
     * `ctx.record` (freeze a value replay can't re-derive) and `ctx.predict`
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

    constructor(instance: object, opts: ReconcilerOptions<S, I>) {
        super(opts);
        this.instance = instance;
        this.fields = opts.fields as readonly string[];
        this.step = opts.step;
        for (const f of this.fields) {
            const v = (instance as Record<string, unknown>)[f];
            this.local[f] = v as number | boolean;
            if (typeof v === "number") { this.numericFields.push(f); this.prev[f] = v; this.error[f] = 0; }
        }
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
    protected applyStep(input: I): void { this.step(this.stepCtx, this.local as S, input); }

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
    }
}

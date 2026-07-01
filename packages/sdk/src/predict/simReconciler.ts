/**
 * SimReconciler — server-reconciled rollback for the entity (or entities) your
 * inputs control, when their authoritative truth isn't a single flat scalar list.
 *
 * The general counterpart to {@link Reconciler}. Both run the SAME rollback loop
 * (shared via {@link RollbackController}); where `Reconciler` mirrors a declared
 * `fields` list off ONE authoritative schema instance, `SimReconciler`
 * orchestrates that loop over whatever your inputs affect:
 *   - **composite scalar state** — several schema instances stepped together by a
 *     shared plain-math sim (e.g. `{ paddle, puck }`: your paddle by input, the puck
 *     it bounces, reconciled as one), or
 *   - **opaque engine state** — a physics solver whose truth (contacts, velocities,
 *     sub-bodies) is far more than a handful of numbers.
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
 * > plus what replay re-derives. Both shipped consumers (composite scalars; a
 * > physics-engine shooter reseeding position+velocity) are well-served by this; an
 * > engine that depends on internal state surviving reconcile would need a per-tick
 * > snapshot ring, which this controller intentionally does not carry.
 *
 * Smooth error correction moves to the RENDER POSE returned by
 * {@link SimReconcilerOptions.pose} (a record of numbers): a misprediction is absorbed
 * into a per-pose-field visual offset that decays to 0 over a few frames, so
 * corrections never pop. For non-lerp poses (3D quaternions) pass
 * {@link SimReconcilerOptions.interpolate} — the default is a per-field numeric lerp
 * (translation/scalar only).
 *
 * Fixed-timestep, same shape as `Reconciler`, and a pure OBSERVER: you mutate + send
 * through the input handle directly; `predict.tick(now)` returns how many fixed steps
 * are due and drives reconcile + decay; the controller subscribes to the handle's
 * `onSend` and runs `step` for each input right as you send it. Render reads
 * ({@link value}/{@link pose}) interpolate between the two latest steps so motion stays
 * smooth above the step rate.
 *
 * The lifecycle of the three callbacks — when each fires, keyed to network acks the
 * app never sees directly:
 *
 *     your render frame:
 *                                          ┌─ new ack? ─▶ adopt(world)                adopt server truth
 *       n = predict.tick(now) ─────────────┤             step(ctx, cmd, world) × pend  replay, isReplay=true
 *                                          │             pose(world)                   re-sample pose (once)
 *                                          └─ always ──▶ error decay
 *       n × (input.data = …; input.send()) ─▶            step(ctx, cmd, world)         live, isReplay=false (on send)
 *       draw(me.value("x"))                ◀── pure read: interpolate + smooth
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
 *     const n = predict.tick(now);                                // fixed steps due this frame
 *     for (let i = 0; i < n; i++) { stage(input.data); input.send(); } // mutate + send via handle
 *     draw(me.value("x"), me.value("puckX"));                      // flat pose key — no path eval
 *
 * Engine-backed example (a physics solver — the `world` handle reaches it + a body):
 *
 *     const me = predict.sim({
 *         input,
 *         world: { world, body },                                  // the engine handle
 *         step:  (ctx, cmd, w) => { applyInput(w.body, cmd); w.world.step(); }, // dt = ctx.dt
 *         adopt: (w) => { w.body.setTranslation({ x: self.x, y: self.y }, true); },
 *         pose:  (w) => { const t = w.body.translation(); return { x: t.x, y: t.y }; },
 *     });
 */

import { RollbackController, type RollbackOptions, type StepContext } from "./rollback.ts";

export interface SimReconcilerOptions<I, P extends Record<string, number>, E> extends RollbackOptions<I> {
    /**
     * Your world handle — whatever your callbacks need to reach the simulated state.
     * Composite scalars (`{ paddle, puck }`) or an engine handle (`{ world, body }`,
     * `{ world, id }`, … for a physics solver). Stored once and passed to every
     * callback; never swapped (no snapshot ring to thread a fresh root through).
     */
    world: E;
    /**
     * Deterministic input-application step, SHARED with the server. Apply `command`
     * to `world` and advance it by `ctx.dt` (the engine's internal timestep MUST
     * equal `ctx.dt` for replay to reproduce the server). `ctx.isReplay` is `true`
     * during rollback re-sim — gate one-shot side effects on `!ctx.isReplay`.
     *
     * `command` is the buffered wire input the handle recorded at `send()`
     * (`input.at(seq)`) — the round-tripped value the server decodes, read the same
     * way on the live catch-up step and on rollback replay, so lossy wire fields
     * replay identically.
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
}

export class SimReconciler<I = any, P extends Record<string, number> = any, E = any> extends RollbackController<I> {
    /** Your world handle — set once at construction, passed to every callback,
     *  never swapped (no snapshot ring). */
    private readonly worldHandle: E;

    /** Current step's RAW pose (`pose(world)`), refreshed after every step. */
    private readonly curPose: Record<string, number> = {};
    /** Pose field names, captured from the first {@link refreshPose}. */
    private poseFields: readonly string[] = [];
    private fieldsReady = false;

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

    constructor(opts: SimReconcilerOptions<I, P, E>) {
        super(opts);
        this.worldHandle = opts.world;
        this.step = opts.step;
        this.adopt = opts.adopt;
        this.readPose = opts.pose;
        this.interpolate = opts.interpolate;
        // Seed pose from the world's current state.
        this.refreshPose();
        for (const f of this.poseFields) { this.prev[f] = this.curPose[f]; this.error[f] = 0; }
    }

    /** Read the world pose into {@link curPose} (capturing the field set once). */
    private refreshPose(): void {
        const pose = this.readPose(this.worldHandle) as Record<string, number>;
        if (!this.fieldsReady) { this.poseFields = Object.keys(pose); this.fieldsReady = true; }
        for (const f of this.poseFields) this.curPose[f] = pose[f];
        this.poseDirty = true;
    }

    /** Your world handle (passed to every callback). Always current — inputs are
     *  stepped eagerly as you `send()` them (the reconciler observes the handle). */
    get world(): E { return this.worldHandle; }

    /**
     * Rendered value for one pose field: the predicted pose interpolated between
     * the previous and current fixed step by {@link renderAlpha}, plus the decaying
     * correction offset. When a custom {@link SimReconcilerOptions.interpolate} is
     * set, reads it off the interpolated {@link pose}.
     */
    value(field: keyof P & string): number {
        if (this.interpolate) return (this.pose() as Record<string, number>)[field];
        const c = this.curPose[field] + (this.error[field] ?? 0);
        const p = this.prev[field] ?? c;
        return p + (c - p) * this.renderAlpha();
    }

    /**
     * The full interpolated + smooth-corrected render pose. Use this (not repeated
     * {@link value} calls) when a custom `interpolate` is set — it's computed once
     * per frame and memoized. The returned record is REUSED — read it synchronously.
     */
    pose(): P {
        if (!this.poseDirty) return this.renderPose as unknown as P;
        const t = this.renderAlpha();
        const a = this.poseA, b = this.poseB;
        for (const f of this.poseFields) { a[f] = this.prev[f] ?? this.curPose[f]; b[f] = this.curPose[f] + (this.error[f] ?? 0); }
        if (this.interpolate) {
            const out = this.interpolate(a as P, b as P, t) as Record<string, number>;
            for (const f of this.poseFields) this.renderPose[f] = out[f];
        } else {
            for (const f of this.poseFields) this.renderPose[f] = a[f] + (b[f] - a[f]) * t;
        }
        this.poseDirty = false;
        return this.renderPose as unknown as P;
    }

    // --- RollbackController hooks ----------------------------------------------

    protected smoothedFields(): readonly string[] { return this.poseFields; }
    protected readCurrent(field: string): number { return this.curPose[field]; }
    protected applyStep(input: I): void { this.step(this.stepCtx, input, this.worldHandle); }
    protected adoptTruth(): void { this.adopt(this.worldHandle); }
    protected refreshRender(): void { this.refreshPose(); }
    protected markDirty(): void { this.poseDirty = true; }

    protected snapshotPrev(): void {
        for (const f of this.poseFields) this.prev[f] = this.curPose[f] + this.error[f];
    }

    protected reseedState(): void {
        this.adopt(this.worldHandle);
        this.refreshPose();
        for (const f of this.poseFields) { this.prev[f] = this.curPose[f]; this.error[f] = 0; }
    }
}

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
 * AUTO-BOUND ENTRIES — the composite-scalar case is declarative: put the DECODED
 * schema instances themselves in `world` and the controller derives everything
 * from their schema metadata:
 *   - each bound entry is replaced IN PLACE by a plain scratch **mirror** seeded
 *     from the instance's scalar fields — `step` mutates the mirror, never the
 *     decoded tree;
 *   - reconcile re-copies every bound field from the instance on EVERY ack
 *     (unconditional pull — replay has mutated the mirror since the last adopt,
 *     so even an unchanged field must be re-seeded or replay double-applies);
 *   - numeric bound fields become render-pose fields keyed `"<part>.<field>"`
 *     (`"paddle.x"`, `"puck.vx"`), smoothed + interpolated like any pose field;
 *     non-numeric scalars (strings, booleans) are adopted verbatim but not posed.
 *     The owning `Predict` also registers each bound (instance, numeric field)
 *     into `predict.value(instance, field)`, so bound entities render through the
 *     same read idiom as remotes.
 *
 * Detection is by decode identity, top-level `world` entries only (deliberately
 * shallow): an entry with a decoder-assigned refId is part of the replicated tree,
 * i.e. a truth source — bound. A locally-constructed schema instance (no refId)
 * throws (pass the decoded one, or a plain object for scratch). Anything else —
 * engine handles, plain literals — is opaque and untouched; to keep a decoded
 * instance opaque on purpose, nest it below a plain wrapper.
 *
 * Bound sources are PINNED at construction: a server-side ref swap
 * (`state.puck = new Puck()`) is not followed — recreate the controller if your
 * server replaces instances (in-place mutation is the norm).
 *
 * For opaque state, `adopt` / `pose` remain what they always were, and compose
 * with bound entries: bound triples adopt FIRST, then your `adopt` covers the
 * rest (it may derive from just-adopted mirrors); a custom `pose` contributes
 * fields in addition to the bound parts' auto fields (its keys win on collision).
 * At least one restore path is required — zero bound entries and no `adopt`
 * throws at construction.
 *
 * > **Tradeoff:** adopt reseeds SCALARS (bound fields + whatever your `adopt`
 * > copies) and replay reproduces the rest. Engine-INTERNAL non-scalar state
 * > (contact caches, sleeping islands, solver accumulators) is NOT rolled back
 * > across reconcile. Both shipped consumers (composite scalars; a physics-engine
 * > shooter reseeding position+velocity) are well-served by this; an engine that
 * > depends on internal state surviving reconcile would need a per-tick snapshot
 * > ring, which this controller intentionally does not carry.
 *
 * Smooth error correction operates on the RENDER POSE (auto-derived from bound
 * numeric fields, and/or returned by {@link SimReconcilerOptions.pose}): a
 * misprediction is absorbed into a per-pose-field visual offset that decays to 0
 * over a few frames, so corrections never pop. For non-lerp poses (3D
 * quaternions) pass {@link SimReconcilerOptions.interpolate} — the default is a
 * per-field numeric lerp (translation/scalar only).
 *
 * Fixed-timestep, same shape as `Reconciler`, and a pure OBSERVER: you mutate + send
 * through the input handle directly; `predict.tick(now)` returns how many fixed steps
 * are due and drives reconcile + decay; the controller subscribes to the handle's
 * `onSend` and runs `step` for each input right as you send it. Render reads
 * ({@link value}/{@link pose}) interpolate between the two latest steps so motion stays
 * smooth above the step rate.
 *
 * The lifecycle, keyed to network acks the app never sees directly:
 *
 *     your render frame:
 *                                          ┌─ new ack? ─▶ adopt (bound pulls + adopt())  adopt server truth
 *       n = predict.tick(now) ─────────────┤             step(ctx, cmd, world) × pend    replay, isReplay=true
 *                                          │             refresh pose (once)
 *                                          └─ always ──▶ error decay
 *       n × (input.data = …; input.send()) ─▶            step(ctx, cmd, world)           live, isReplay=false (on send)
 *       draw(predict.value(player, "x"))   ◀── pure read: interpolate + smooth
 *
 * Composite-scalar example (no engine — the common case):
 *
 *     const input = room.input({ type: MoveInput, mode: "reliable" });
 *     const me = predict.sim({
 *         input,
 *         world: {
 *             paddle: player,                                      // decoded schema ⇒ auto-bound
 *             puck:   room.state.puck,                             // ⇒ auto-bound (x, y, vx, vy)
 *         },
 *         step: (ctx, cmd, w) => stepWorld(w, cmd, ctx.dt),        // SHARED with the server
 *         smoothing: 15,
 *     });
 *     const n = predict.tick(now);                                 // fixed steps due this frame
 *     for (let i = 0; i < n; i++) { stage(input.data); input.send(); } // mutate + send via handle
 *     draw(predict.value(player, "x"), predict.value(room.state.puck, "x")); // one read idiom
 *     aim(me.world.paddle);                                        // raw predicted state for logic
 *
 * Engine-backed example (a physics solver — opaque world, explicit adopt/pose):
 *
 *     const me = predict.sim({
 *         input,
 *         world: { world, body },                                  // the engine handle
 *         step:  (ctx, cmd, w) => { applyInput(w.body, cmd); w.world.step(); }, // dt = ctx.dt
 *         adopt: (w) => { w.body.setTranslation({ x: self.x, y: self.y }, true); },
 *         pose:  (w) => { const t = w.body.translation(); return { x: t.x, y: t.y }; },
 *     });
 */

import type { Schema } from "@colyseus/schema";
import { RollbackController, type RollbackOptions, type StepContext } from "./rollback.ts";
import { refIdOf, metadataOf, scalarFieldsOf } from "./schema.ts";

// -----------------------------------------------------------------------------
// Compile-time sugar for auto-bound worlds. Runtime detection is refId-based;
// these types mirror it structurally (`Schema`'s class surface — assign/restore/
// setDirty — is distinctive enough that engine handles can't false-match, and
// the fluent API's instance type is `{fields} & Schema`, so both authoring
// styles are covered).
// -----------------------------------------------------------------------------

/** Keys of T whose decoded value is a plain scalar (the mirror's field set). */
type ScalarKeys<T> = {
    [K in keyof T]-?: NonNullable<T[K]> extends number | string | boolean ? K : never;
}[keyof T] & string;

/** The plain scratch mirror a bound schema instance materializes into. */
export type ScalarsOf<T> = Pick<T, ScalarKeys<T>>;

/** Keys of T whose decoded value is a number (the pose/smoothing subset). */
type NumericKeys<T> = {
    [K in keyof T]-?: NonNullable<T[K]> extends number ? K : never;
}[keyof T] & string;

/**
 * The world shape `step` / `adopt` / `pose` receive and {@link SimReconciler.world}
 * returns: decoded schema entries are replaced by their plain scalar mirrors;
 * opaque entries pass through unchanged.
 */
export type Materialize<E> = {
    [K in keyof E]: E[K] extends Schema ? ScalarsOf<E[K]> : E[K];
};

/** Auto-derived pose keys for the bound entries of a world: `"<part>.<field>"`
 *  per numeric scalar field (`"paddle.x"`, `"puck.vx"`). */
export type BoundPoseKeys<E> = {
    [K in keyof E & string]: E[K] extends Schema ? `${K}.${NumericKeys<E[K]>}` : never;
}[keyof E & string];

/** One auto-bound world entry, resolved at construction: the pinned decoded
 *  source, its in-world mirror, and the field sets derived from schema metadata
 *  (`fields` = every scalar, the adopt set; `numeric` ⊆ `fields`, the pose set;
 *  `poseKeys` parallel to `numeric`). */
interface BindingTriple {
    source: Record<string, any>;
    mirror: Record<string, any>;
    fields: readonly string[];
    numeric: readonly string[];
    poseKeys: readonly string[];
}

export interface SimReconcilerOptions<I, P extends Record<string, number>, E> extends RollbackOptions<I> {
    /**
     * Your world handle — whatever your callbacks need to reach the simulated
     * state. Entries that are DECODED schema instances (`{ paddle: player,
     * puck: state.puck }`) are auto-bound: replaced in place by plain scalar
     * mirrors that the controller seeds, re-adopts on every ack, and poses (see
     * the file header). Everything else — an engine handle (`{ world, body }`),
     * plain scratch literals — is opaque and untouched. Stored once and passed
     * to every callback; never swapped (no snapshot ring to thread a fresh root
     * through). Capture bound parts via `me.world` AFTER construction (the
     * mirror replaces the instance on this very object).
     */
    world: E;
    /**
     * Deterministic input-application step, SHARED with the server. Apply `command`
     * to `world` and advance it by `ctx.dt` (the engine's internal timestep MUST
     * equal `ctx.dt` for replay to reproduce the server). One-shot concerns go
     * through `ctx.memo` (freeze a value replay can't re-derive) and
     * `ctx.predict` (optimistic events — live steps only, replay-safe).
     *
     * `command` is the buffered wire input the handle recorded at `send()`
     * (`input.at(seq)`) — the round-tripped value the server decodes, read the same
     * way on the live catch-up step and on rollback replay, so lossy wire fields
     * replay identically.
     */
    step: (ctx: StepContext, command: I, world: Materialize<E>) => void;
    /**
     * Adopt the server's authoritative truth into `world`'s OPAQUE entries: seed
     * them from the authoritative scalars on your schema instance(s). Called on
     * every server ack, BEFORE the unacked inputs are replayed on top — and AFTER
     * the bound entries' auto-adopt, so it may derive from just-adopted mirrors
     * (e.g. reseed an engine body from a bound part). The whole patch is decoded
     * before the ack is processed, so reading several instances in one `adopt`
     * adopts them all from the same server tick.
     *
     * Optional when bound entries cover the world; REQUIRED when nothing is
     * bound (there'd be no restore point — construction throws).
     */
    adopt?: (world: Materialize<E>) => void;
    /**
     * Read `world`'s OPAQUE entries into a render pose — a record of numbers
     * (e.g. `{ x, y }` or `{ x, y, z, qx, qy, qz, qw }`). Called after every
     * step/reconcile; smoothing and interpolation operate on these fields IN
     * ADDITION to the bound entries' auto-derived `"<part>.<field>"` fields
     * (custom keys win on collision). May return a reused object — the
     * controller copies the numbers out synchronously. The field set is taken
     * from the first call and assumed stable. Optional — bound-only worlds
     * need no pose callback at all.
     */
    pose?: (world: Materialize<E>) => P;
    /**
     * Custom pose interpolation `a → b` by `t ∈ [0,1]`. Required for poses that
     * don't lerp componentwise (quaternions → slerp + renormalize). Default is a
     * per-field numeric lerp. `a`/`b` may be reused scratch — don't retain them.
     */
    interpolate?: (a: P, b: P, t: number) => P;
}

export class SimReconciler<I = any, P extends Record<string, number> = any, E = any> extends RollbackController<I> {
    /** Your world handle — set once at construction (bound entries already
     *  materialized into mirrors), passed to every callback, never swapped. */
    private readonly worldHandle: Materialize<E>;

    /** Auto-bound entries (decoded schema instances found in `world`),
     *  resolved once at construction. Empty for fully-opaque worlds. */
    private readonly bindings: BindingTriple[] = [];

    /** Current step's RAW pose, refreshed after every step: bound
     *  `"<part>.<field>"` fields read off the mirrors + the custom `pose`
     *  callback's fields (written after — custom wins on key collision). */
    private readonly curPose: Record<string, number> = {};
    /** Pose field names (bound keys ∪ custom keys), captured on the first
     *  {@link refreshPose}. */
    private poseFields: readonly string[] = [];
    /** The custom `pose` callback's own field names (first-call snapshot). */
    private customFields: readonly string[] = [];
    private fieldsReady = false;

    /** Reused scratch for {@link pose}: smoothed prev/cur endpoints + memo. */
    private readonly poseA: Record<string, number> = {};
    private readonly poseB: Record<string, number> = {};
    private readonly renderPose: Record<string, number> = {};
    /** Set whenever the pose endpoints/alpha change; {@link pose} recomputes once. */
    private poseDirty = true;

    private readonly step: (ctx: StepContext, command: I, world: Materialize<E>) => void;
    private readonly adopt?: (world: Materialize<E>) => void;
    /** The `pose` option callback, stored under a distinct name so it doesn't
     *  shadow the public {@link pose} method. */
    private readonly readPose?: (world: Materialize<E>) => P;
    private readonly interpolate?: (a: P, b: P, t: number) => P;

    constructor(opts: SimReconcilerOptions<I, P, E>) {
        super(opts);

        // Scan the world for decoded schema instances (top-level entries only —
        // deliberately shallow) and materialize each into a plain mirror IN
        // PLACE, so `step` and the app (via `me.world`) see the same object.
        const world = opts.world as Record<string, any>;
        for (const part of Object.keys(world)) {
            const src = world[part];
            if (src === null || typeof src !== "object") continue;
            if (refIdOf(src) === undefined) {
                if (metadataOf(src) !== undefined) {
                    throw new Error(
                        `predict.sim(): world.${part} is a schema instance that hasn't been ` +
                        "decoded (no refId). Pass the decoded instance from room.state (e.g. " +
                        "inside onAdd), or a plain object for opaque scratch.",
                    );
                }
                continue;   // opaque entry (engine handle, scratch literal)
            }
            const { fields, numeric } = scalarFieldsOf(src);
            if (fields.length === 0) {
                throw new Error(
                    `predict.sim(): world.${part} is a decoded ref with no scalar fields ` +
                    "to bind. Binding a whole COLLECTION isn't supported (yet) — spread " +
                    "its children into world parts (one entry per entity, fixed at " +
                    "construction). Nest a scalar-less instance below a plain wrapper " +
                    "if you meant it as an opaque handle.",
                );
            }
            const mirror: Record<string, any> = {};
            for (const f of fields) mirror[f] = src[f];
            world[part] = mirror;
            const poseKeys = numeric.map((f) => `${part}.${f}`);
            this.bindings.push({ source: src, mirror, fields, numeric, poseKeys });
        }
        if (this.bindings.length === 0 && opts.adopt === undefined) {
            throw new Error(
                "predict.sim(): no restore point — world has no schema-bound entries " +
                "and no adopt() was provided. Put decoded schema instances in world " +
                "(auto-bound), or provide adopt().",
            );
        }

        this.worldHandle = opts.world as unknown as Materialize<E>;
        this.step = opts.step;
        this.adopt = opts.adopt;
        this.readPose = opts.pose;
        this.interpolate = opts.interpolate;
        // Seed pose from the world's current state.
        this.refreshPose();
        for (const f of this.poseFields) { this.prev[f] = this.curPose[f]; this.error[f] = 0; }
    }

    /** Read the world pose into {@link curPose}: bound fields off the mirrors,
     *  then the custom `pose` callback's fields (custom wins on collision).
     *  Captures the pose field set once, on the first call. */
    private refreshPose(): void {
        const cur = this.curPose;
        for (const b of this.bindings) {
            const { mirror, numeric, poseKeys } = b;
            for (let i = 0; i < numeric.length; i++) cur[poseKeys[i]] = mirror[numeric[i]] as number;
        }
        if (this.readPose !== undefined) {
            const pose = this.readPose(this.worldHandle) as Record<string, number>;
            if (!this.fieldsReady) this.customFields = Object.keys(pose);
            for (const f of this.customFields) cur[f] = pose[f];
        }
        if (!this.fieldsReady) {
            const keys: string[] = [];
            for (const b of this.bindings) for (const k of b.poseKeys) keys.push(k);
            for (const f of this.customFields) if (!keys.includes(f)) keys.push(f);
            this.poseFields = keys;
            this.fieldsReady = true;
        }
        this.poseDirty = true;
    }

    /** Your world handle (passed to every callback). Bound entries read as their
     *  plain mirrors — capture parts from HERE (post-construction), not from the
     *  literal you passed in. Always current — inputs are stepped eagerly as you
     *  `send()` them (the reconciler observes the handle). */
    get world(): Materialize<E> { return this.worldHandle; }

    /** @internal Bound (instance, numeric field, pose key) registrations for the
     *  owning Predict's `value()` overlay — one entry per bound world part. */
    get boundRegistrations(): ReadonlyArray<{ source: object; fields: readonly string[]; poseKeys: readonly string[] }> {
        return this.bindings.map((b) => ({ source: b.source, fields: b.numeric, poseKeys: b.poseKeys }));
    }

    /**
     * Rendered value for one pose field — bound fields by their dotted key
     * (`"paddle.x"`), custom pose fields by their own name: the predicted pose
     * interpolated between the previous and current fixed step by
     * {@link renderAlpha}, plus the decaying correction offset. When a custom
     * {@link SimReconcilerOptions.interpolate} is set, reads it off the
     * interpolated {@link pose}. For bound entities prefer the room-wide idiom
     * `predict.value(instance, field)` — same value, no handle threading.
     */
    value(field: BoundPoseKeys<E> | (keyof P & string)): number {
        this.noteRenderRead();
        if (this.interpolate) return (this.pose() as Record<string, number>)[field];
        const c = this.curPose[field] + (this.error[field] ?? 0);
        const p = this.prev[field] ?? c;
        return p + (c - p) * this.renderAlpha();
    }

    /**
     * The full interpolated + smooth-corrected render pose (bound `"part.field"`
     * keys included). Use this (not repeated {@link value} calls) when a custom
     * `interpolate` is set — it's computed once per frame and memoized. The
     * returned record is REUSED — read it synchronously.
     */
    pose(): P {
        this.noteRenderRead();
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

    /** Bound triples pull first — every bound field, unconditionally (replay has
     *  mutated the mirrors since the last adopt, so even a server-unchanged field
     *  must be re-seeded or the next replay double-applies inputs on top of a
     *  stale predicted value). The user `adopt` then covers the opaque rest. */
    protected adoptTruth(): void {
        for (const b of this.bindings) {
            const { source, mirror, fields } = b;
            for (let i = 0; i < fields.length; i++) mirror[fields[i]] = source[fields[i]];
        }
        this.adopt?.(this.worldHandle);
    }

    protected refreshRender(): void { this.refreshPose(); }
    protected markDirty(): void { this.poseDirty = true; }

    protected snapshotPrev(): void {
        for (const f of this.poseFields) this.prev[f] = this.curPose[f] + this.error[f];
    }

    protected reseedState(): void {
        this.adoptTruth();
        this.refreshPose();
        for (const f of this.poseFields) { this.prev[f] = this.curPose[f]; this.error[f] = 0; }
    }
}

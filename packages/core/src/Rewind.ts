import type { MapSchema, ArraySchema, SetSchema } from "@colyseus/schema";

const DEFAULT_MAX_REWIND_MS = 500;
/** Ring-sizing fallback when the record cadence isn't supplied (manual `record(now)`
 *  without a hint). `allowRewindState` feeds the real sim interval, so this only
 *  matters for ad-hoc manual use. */
const DEFAULT_SAMPLE_INTERVAL_MS = 1000 / 60;

// Hot record() path: dense `$values[index]` is ~15× faster than `inst[fieldName]`; entity symbol prop ~8× faster than a WeakMap.
const $VALUES: symbol = Symbol.for("$values");
const $METADATA: symbol = (Symbol as { metadata?: symbol }).metadata ?? Symbol.for("Symbol.metadata");
/** Per-entity history, under this private symbol ON the entity. Symbol-keyed so it's
 *  invisible to Object.keys / `assign` / `clone`, and GC'd with the entity. */
const $HISTORY = Symbol("rewind.history");

/** Keys of T whose value type is `number` — the only rewindable fields. */
type NumericKeys<T> = { [K in keyof T]-?: T[K] extends number ? K : never }[keyof T] & string;
/** A Colyseus collection whose element type is `E`. Inferring `E` from the live
 *  collection the caller passes is what lets `fields` narrow with zero state-type
 *  plumbing. */
type Collection<E> = MapSchema<E> | ArraySchema<E> | SetSchema<E>;

/** Options for {@link Rewind.get} / {@link Room.allowRewindState}. */
export interface RewindOptions {
  /** Default rewind window (ms) for attaches that don't pass their own — sizes the
   *  per-entity history ring. Per-attach `maxRewindMs` overrides it. Default 500. */
  maxRewindMs?: number;
}

/** Field's `$values` index from the schema metadata (`metadata[name]` = index), or
 *  -1 if unknown. Resolved ONCE per constructor (cold path), never per tick. */
function fieldIndexOf(instance: object, field: string): number {
  const md = (instance.constructor as any)[$METADATA] as Record<string, unknown> | undefined;
  const idx = md?.[field];
  return typeof idx === "number" ? idx : -1;
}

/** = @colyseus/schema `$typeOptionPrefix + "lagComp"` (string metadata key). */
const $LAGCOMP = "~__opt:lagComp";

/** Schema-declared lag-comp behavior for the entity's TYPE. */
export type LagCompMode = "snapshot" | "reckon" | "none";

/**
 * Resolve the type's `lagComp` declaration (`schema({...}, "Enemy")
 * .with({ lagComp: "reckon" })` / `@entity({ lagComp })`) — `"snapshot"` when
 * undeclared. Reads purely from `instance.constructor` through the metadata
 * prototype chain (subclasses inherit), so it works on detached instances —
 * no state-tree parenting needed. The single extension point for future
 * modes: new values resolve here and map to a timeline in {@link Rewind.at}.
 */
function lagCompOf(instance: object): LagCompMode {
  const md = (instance.constructor as any)[$METADATA] as Record<string, unknown> | undefined;
  const mode = md?.[$LAGCOMP];
  return mode === "reckon" || mode === "none" ? mode : "snapshot";
}

/**
 * Per-entity ring of recent field snapshots. `valueAt(time, col)` reconstructs
 * one field's recorded PATH at an arbitrary past time — `linear` interp for
 * continuous motion (patrol, a sine bob), or `step` (hold the last value) for
 * discrete motion (teleport snaps), where a lerp would smear across the jump.
 */
class EntityHistory {
  readonly fields: readonly string[];
  /** The TYPE's schema `lagComp: "reckon"` declaration, mirrored here so a view
   *  can pick its aim time per entity (the entity's history is its only link). */
  readonly reckoned: boolean;
  /** Each tracked field's index into the entity's dense `$values` array —
   *  resolved per CONSTRUCTOR (mixed-type collections differ per type). */
  private readonly fieldIdx: readonly number[];
  private readonly cap: number;
  private readonly t: Float64Array;
  private readonly cols: Float64Array[];   // one column per field
  private readonly step: boolean;           // hold (vs lerp) between samples
  private head = 0;                         // next write slot
  private count = 0;

  constructor(fields: readonly string[], fieldIdx: readonly number[], maxRewindMs: number, sampleIntervalMs: number, step: boolean, reckoned: boolean) {
    this.fields = fields;
    this.fieldIdx = fieldIdx;
    this.step = step;
    this.reckoned = reckoned;
    this.cap = Math.max(2, Math.ceil(maxRewindMs / sampleIntervalMs) + 4);
    this.t = new Float64Array(this.cap);
    this.cols = fields.map(() => new Float64Array(this.cap));
  }

  /** `values` = the entity's dense `$values` array. Direct array reads — no
   *  per-field megamorphic accessor. */
  record(time: number, values: ArrayLike<number>): void {
    const fieldIdx = this.fieldIdx;
    this.t[this.head] = time;
    for (let f = 0; f < fieldIdx.length; f++) this.cols[f][this.head] = values[fieldIdx[f]];
    this.head = (this.head + 1) % this.cap;
    if (this.count < this.cap) this.count++;
  }

  /** Interpolated value of column `col` at `time`, clamped to the retained range. */
  valueAt(time: number, col: number): number {
    const c = this.cols[col];
    const oldest = (this.head - this.count + this.cap) % this.cap;
    if (time <= this.t[oldest]) return c[oldest];
    const newest = (this.head - 1 + this.cap) % this.cap;
    if (time >= this.t[newest]) return c[newest];
    let prev = oldest;
    for (let i = 1; i < this.count; i++) {
      const idx = (oldest + i) % this.cap;
      if (this.t[idx] >= time) {
        if (this.step) return c[prev];   // discrete: hold the value before `time`
        const t0 = this.t[prev], t1 = this.t[idx];
        const a = t1 > t0 ? (time - t0) / (t1 - t0) : 0;
        return c[prev] + (c[idx] - c[prev]) * a;
      }
      prev = idx;
    }
    return c[newest];   // unreachable: `newest` guard above covers it
  }
}

/** Shared history for `lagComp: "none"` types: zero rings, `record()` no-ops,
 *  and every `valueAt` read misses the empty field list → live fallback. One
 *  instance serves all such entities — assigning it (vs leaving `$HISTORY`
 *  unset) keeps the hot record loop from re-resolving the type every tick. */
const NONE_HISTORY = new EntityHistory([], [], 1, 1, false, false);
NONE_HISTORY.record = () => {};   // own no-op shadows the prototype method

/** How `valueAt` reconstructs a value between recorded samples: `linear` interp
 *  (continuous motion) or `step` = hold the last sample (discrete motion). */
type Interp = "linear" | "step";

/**
 * A read-only view of the tracked world at ONE past time — the rewound state a
 * hit test reads instead of live positions. Created by {@link Rewind.at} /
 * {@link Rewind.lastSeenBy}, which bake in the `maxRewindMs` clamp and the
 * live-fallback so callers never re-implement either.
 *
 * The view assumes NOTHING about your schema's field names — you name the
 * fields (and therefore the shape) at the call site:
 *
 * ```ts
 * const seen = rewind.lastSeenBy(shooterSessionId);
 * // read fields directly…
 * overlaps(bullet, seen.value(target, "x"), seen.value(target, "y"));
 * // …or batch them into an object shaped by YOUR field list:
 * const pos = seen.read(target, ["x", "y"]);        // { x, y }
 * seen.read(enemy, ["x", "y"], this.seenScratch);   // fill + return a reused scratch
 * ```
 *
 * By default `at`/`lastSeenBy` re-aim and return the Rewind's own internal
 * view — the usual "one view at a time, read it right away" flow is zero-alloc
 * AND zero-setup (the server is single-threaded; nothing interleaves a
 * synchronous read). Need more than one view alive at once (compare two
 * shooters' perspectives, A/B a rewind window)? Pass your own instance as
 * their `out` — it is re-aimed and returned instead of the shared one:
 *
 * ```ts
 * const a = rewind.lastSeenBy(shooterA);                      // shared default view
 * const b = rewind.lastSeenBy(shooterB, new RewindView());    // independent second view
 * ```
 *
 * Don't store a view across calls or ticks: the default is re-aimed by the
 * next `at`/`lastSeenBy`, and ANY view's clamp was computed against
 * `lastRecordedAt`, so it goes stale at the next `record()` regardless.
 */
export class RewindView {
  /** Bound (and re-bound) by {@link _retarget} — a bare `new RewindView()` is
   *  un-aimed scratch until it first passes through at()/lastSeenBy(). */
  private rewind?: Rewind;
  private _time = 0;
  private _reckonTime = 0;

  /** The clamped server-time (ms) this view reads at — after the maxRewindMs
   *  clamp and the live (newest-sample) fallback. Mostly for logging/debug. */
  get time(): number { return this._time; }

  /** The clamped server-time (ms) `lagComp: "reckon"` types read at — the
   *  client's reconstructed simulation instant, not the raw stamp (see
   *  {@link Rewind.at}). */
  get reckonTime(): number { return this._reckonTime; }

  /** @internal Aim at a rewind + clamped times ({@link Rewind.at} owns the clamps). */
  _retarget(rewind: Rewind, at: number, reckonAt: number): this {
    this.rewind = rewind;
    this._time = at;
    this._reckonTime = reckonAt;
    return this;
  }

  /** Rewound value of a numeric `field` on `entity` (live if it isn't tracked). */
  value<T extends object>(entity: T, field: NumericKeys<T>): number {
    if (this.rewind === undefined) {
      throw new Error("RewindView is not aimed — obtain it from rewind.at()/lastSeenBy(), or pass it to them as `out`.");
    }
    // lagComp:"reckon" types aim at the reconstructed send instant, not the stamp.
    const h = (entity as any)[$HISTORY] as EntityHistory | undefined;
    return this.rewind.valueAt(entity, h?.reckoned ? this._reckonTime : this._time, field);
  }

  /**
   * Batch {@link value} reads: the `fields` YOU list define the result's shape
   * (`Record<field, number>`). Pass `out` to fill (and return) a reused scratch
   * instead of allocating — its properties beyond `fields` are left untouched,
   * so a scratch can carry extra context (an `alive` flag, say).
   */
  read<T extends object, F extends NumericKeys<T>, O extends Record<F, number> = Record<F, number>>(
    entity: T,
    fields: readonly F[],
    out?: O,
  ): O {
    const o = (out ?? {}) as Record<F, number>;
    for (let i = 0; i < fields.length; i++) o[fields[i]] = this.value(entity, fields[i]);
    return o as O;
  }
}

/** Array-form `fields` resolved against one constructor: names with a known
 *  `$values` index, in lock-step. Fields a type doesn't declare are dropped
 *  (they read live) instead of recording `values[-1]` garbage. */
interface ResolvedFields { fields: readonly string[]; idx: readonly number[]; }

interface TrackedGroup {
  entities: () => Iterable<object>;
  fields: readonly string[] | ((entity: any) => readonly string[]);
  /** Per-constructor resolution of array-form `fields` — one entry per entity
   *  type seen in the group (mixed-type collections differ per type). */
  resolvedByCtor: Map<Function, ResolvedFields>;
  maxRewindMs: number;
  interpolate: Interp | ((entity: any) => Interp);
}

/**
 * Per-attach options for {@link Rewind.attachAll} / {@link Rewind.attach}.
 *
 * The rewind TIMELINE per entity type (snapshot stamp vs reckon send-instant
 * vs none) is not declared here — it comes from the type's schema metadata:
 * `schema({...}, "Enemy").with({ lagComp: "reckon" })`. See {@link Rewind.at} for how
 * reckon-declared types aim differently.
 */
interface AttachOptions<E> {
  /** Numeric fields to record per tick. An array applies to every type in the
   *  collection (fields a type lacks are skipped — they read live); a per-entity
   *  fn picks the list per entity, mirroring `interpolate`'s fn form. */
  fields: readonly NumericKeys<E>[] | ((entity: E) => readonly NumericKeys<E>[]);
  maxRewindMs?: number;
  /** How `valueAt` reconstructs between samples (a mode or a per-entity fn,
   *  default `linear`) — use `step` for discrete motion (e.g. teleporters). */
  interpolate?: Interp | ((entity: E) => Interp);
}

/**
 * Server-side lag compensation — the dual of the client's `Predict`. Where
 * `Predict` forward-reckons entities it RECEIVES, `Rewind` records the recent
 * positions of entities it OWNS and rewinds field reads to a past (client
 * render) time, so a hit test judges against where the client actually SAW an
 * entity — not where it has slid to ~RTT later.
 *
 * Prefer {@link Room.allowRewindState}, which creates a `Rewind` and records it
 * automatically each simulation tick:
 *
 * @example
 * ```ts
 * onCreate() {
 *   const rewind = this.allowRewindState({ maxRewindMs: 500 });
 *   rewind.attachAll(this.state.enemies, { fields: ["x", "y"] });  // fields ← Enemy's numeric keys
 *   this.setTimestep((dt) => { ...move enemies... }, 1000 / 30);
 *   // framework calls rewind.record() after each tick.
 * }
 * // in your hit test, with the client's renderTime:
 * const seenX = rewind.valueAt(enemy, renderTime, "x");
 * ```
 *
 * `attachAll` takes the live collection (not a string key), so the element type
 * — and the legal `fields` / `valueAt` field names — are inferred with no
 * state-type generic. Entities are keyed by object identity — removed entities
 * and their history are reclaimed automatically.
 *
 * The rewind TIMELINE per entity type is declared ONCE in the shared schema —
 * `schema({...}, "Enemy").with({ lagComp: "reckon" | "snapshot" | "none" })` — and
 * resolved per entity from its constructor metadata (subclasses inherit):
 * `"snapshot"` (default) reads at the client's raw renderTime stamp, `"reckon"`
 * at the reconstructed send instant (see {@link at}), `"none"` records no
 * history at all (reads are live). The client SDK's Predict reads the same
 * declaration to infer its prediction mode — one source, both sides.
 */
export class Rewind {
  private static readonly byRoom = new WeakMap<object, Rewind>();

  /** One `Rewind` per room (idempotent). `room` is only the cache key. */
  static get(room: object, opts?: RewindOptions): Rewind {
    let r = Rewind.byRoom.get(room);
    if (r === undefined) { r = new Rewind(opts?.maxRewindMs ?? DEFAULT_MAX_REWIND_MS); Rewind.byRoom.set(room, r); }
    return r;
  }

  private readonly groups: TrackedGroup[] = [];
  private readonly defaultMaxRewindMs: number;
  private _sampleIntervalMs = DEFAULT_SAMPLE_INTERVAL_MS;
  private _lastRecordedAt = -1;
  /** Resolves a client's auto-stamped render time (set by `Room.allowRewindState`
   *  when `defineInput({renderTime:true})` is on); powers {@link lastSeenBy}. */
  private _renderTimeOf?: (sessionId: string) => number;
  /** Resolves a client's auto-stamped reckon-display instant (its serverNow
   *  estimate at input-sample time). When present (> 0), {@link lastSeenBy}
   *  reads `lagComp:"reckon"` types AT this stamp directly — exact regardless
   *  of the client's clock/RTT-estimation error (it displayed f(est), we read
   *  f(est)) — instead of reconstructing it via the midpoint. */
  private _reckonTimeOf?: (sessionId: string) => number;
  /** Resolves the CURRENT server time (set by `Room.allowRewindState`) — the
   *  reckon midpoint's "now" anchor in {@link at}. Without it, the anchor falls
   *  back to `lastRecordedAt`, which is one tick stale at hit-test time. */
  private _nowOf?: () => number;
  /** Default view returned by at/lastSeenBy when no `out` is given — one per
   *  Rewind, re-aimed per call (zero alloc, zero userland setup). */
  private readonly _view = new RewindView();

  private constructor(defaultMaxRewindMs: number) { this.defaultMaxRewindMs = defaultMaxRewindMs; }

  /** The default rewind window (ms). Use it to bound a hit test:
   *  `Math.max(renderTime, now - rewind.maxRewindMs)`. */
  get maxRewindMs(): number { return this.defaultMaxRewindMs; }
  /** Server time of the last {@link record} (or -1). The auto-record skips a tick
   *  whose time was already recorded manually — your `record()` wins. */
  get lastRecordedAt(): number { return this._lastRecordedAt; }

  /** Track every entity in a collection (Map/Array/Set schema). `fields` narrows
   *  to its element's numeric fields. `interpolate` (a mode or a per-entity fn,
   *  default `linear`) picks how `valueAt` reconstructs between samples — use
   *  `step` for discrete-motion entities (e.g. teleporters). */
  attachAll<E extends object>(
    collection: Collection<E>,
    opts: AttachOptions<E>,
  ): this {
    const c = collection as unknown as { values(): Iterable<object> };
    this.groups.push({ entities: () => c.values(), fields: opts.fields, resolvedByCtor: new Map(), maxRewindMs: opts.maxRewindMs ?? this.defaultMaxRewindMs, interpolate: opts.interpolate ?? "linear" });
    return this;
  }

  /** Track a single entity (e.g. a boss). `fields` narrows to its numeric fields. */
  attach<E extends object>(instance: E, opts: AttachOptions<E>): this {
    const one: object[] = [instance];   // reused; no per-tick alloc
    this.groups.push({ entities: () => one, fields: opts.fields, resolvedByCtor: new Map(), maxRewindMs: opts.maxRewindMs ?? this.defaultMaxRewindMs, interpolate: opts.interpolate ?? "linear" });
    return this;
  }

  /**
   * Snapshot every tracked entity at `now`. Call once per tick, AFTER they move —
   * {@link Room.allowRewindState} does this for you. `sampleIntervalMs` (the gap
   * between records) sizes the history rings; the framework passes the sim
   * interval. Calling this yourself during a tick suppresses that tick's
   * auto-record (see {@link lastRecordedAt}).
   */
  record(now: number, sampleIntervalMs?: number): void {
    if (sampleIntervalMs !== undefined && sampleIntervalMs > 0) this._sampleIntervalMs = sampleIntervalMs;
    this._lastRecordedAt = now;
    for (const g of this.groups) {
      for (const e of g.entities()) {
        const t = e as any;   // private-symbol access on a foreign schema instance
        let h = t[$HISTORY] as EntityHistory | undefined;
        if (h === undefined) h = this.createHistory(g, e, t);   // cold: once per entity
        h.record(now, t[$VALUES] as ArrayLike<number>);
      }
    }
  }

  /** Cold path — first time an entity is seen by `record()`. Resolves the
   *  type's `lagComp` declaration and the field→`$values` indices (cached per
   *  constructor for array-form `fields`; fn-form resolves per entity). */
  private createHistory(g: TrackedGroup, e: object, t: any): EntityHistory {
    const lagComp = lagCompOf(e);
    if (lagComp === "none") {
      t[$HISTORY] = NONE_HISTORY;
      return NONE_HISTORY;
    }
    let rf: ResolvedFields;
    if (typeof g.fields === "function") {
      rf = this.resolveFields(e, g.fields(e));
    } else {
      let cached = g.resolvedByCtor.get(e.constructor);
      if (cached === undefined) {
        cached = this.resolveFields(e, g.fields);
        g.resolvedByCtor.set(e.constructor, cached);
      }
      rf = cached;
    }
    const mode = typeof g.interpolate === "function" ? g.interpolate(e) : g.interpolate;
    const h = new EntityHistory(rf.fields, rf.idx, g.maxRewindMs, this._sampleIntervalMs, mode === "step", lagComp === "reckon");
    t[$HISTORY] = h;
    return h;
  }

  /** Keep only the fields this entity's type declares (unknown → read live). */
  private resolveFields(e: object, names: readonly string[]): ResolvedFields {
    const fields: string[] = [];
    const idx: number[] = [];
    for (const name of names) {
      const i = fieldIndexOf(e, name);
      if (i >= 0) { fields.push(name); idx.push(i); }
    }
    return { fields, idx };
  }

  /**
   * `instance`'s `field` value at past `time` (interpolated from history). Falls
   * back to the live value when the entity has no history yet, or the field
   * isn't tracked.
   */
  valueAt<T extends object>(instance: T, time: number, field: NumericKeys<T>): number {
    const h = (instance as any)[$HISTORY] as EntityHistory | undefined;
    if (h === undefined) return (instance as Record<string, number>)[field];
    const col = h.fields.indexOf(field);
    return col < 0 ? (instance as Record<string, number>)[field] : h.valueAt(time, col);
  }

  /**
   * @internal Wire a resolver from sessionId → that client's auto-stamped render
   * time. Called by {@link Room.allowRewindState} so {@link lastSeenBy} works; not
   * for direct use (prefer `defineInput({renderTime:true})` + `lastSeenBy`).
   */
  bindRenderTime(resolver: (sessionId: string) => number): void {
    this._renderTimeOf = resolver;
  }

  /**
   * @internal Wire a resolver for the CURRENT server time (ms, same epoch as
   * `record` times). Called by {@link Room.allowRewindState}; standalone users
   * (tests/harnesses) should bind their own. Anchors the reckon midpoint in
   * {@link at} at the true processing instant — the `lastRecordedAt` fallback
   * is one tick stale by hit-test time, biasing the aim ~half a tick early:
   * imperceptible on slow horizontal motion, but enough to flip knife-edge
   * stomp/hit verdicts on fast vertical movers (a bobbing jumper).
   */
  bindNow(resolver: () => number): void {
    this._nowOf = resolver;
  }

  /**
   * @internal Wire a resolver from sessionId → that client's auto-stamped
   * reckon-display instant (`input(sid).reckonTime`). Called by
   * {@link Room.allowRewindState}. With it, {@link lastSeenBy} aims
   * `lagComp:"reckon"` types at the EXACT instant the client displayed them
   * (immune to its RTT-estimation error); without it (or while the stamp is
   * still 0), the midpoint reconstruction in {@link at} is the fallback.
   */
  bindReckonTime(resolver: (sessionId: string) => number): void {
    this._reckonTimeOf = resolver;
  }

  /**
   * A {@link RewindView} of the tracked world at `time` (an acting client's render
   * time), with the two things every hit test re-implements baked in:
   *  - **clamp** to `[lastRecordedAt − maxRewindMs, lastRecordedAt]` — an
   *    anti-spoof / clock-skew bound (a client can't rewind arbitrarily far), and
   *  - **live fallback**: `time <= 0` (the client's clock hasn't synced) → the
   *    newest recorded sample (≈ current position).
   *
   * Sugar over {@link valueAt}; pass the render time yourself (e.g. from
   * `input(sid).renderTime`, or a value stored on the entity). For the common
   * "rewind to a specific client's view" case use {@link lastSeenBy}.
   *
   * Re-aims and returns this Rewind's internal view by default — zero alloc,
   * nothing to declare. Pass `out` to aim a view of your own instead; needed
   * only to hold several views at once — see the {@link RewindView} doc.
   */
  at(time: number, out?: RewindView): RewindView {
    return this._aim(time, 0, out);
  }

  /**
   * Shared aiming: clamp the snapshot-timeline `time`, and resolve the reckon
   * timeline either from the DIRECT `reckonStamp` (the instant the client's
   * forward-reckoned entities were displayed at — exact, immune to the
   * client's RTT-estimation error) or, when absent (0), by reconstruction.
   */
  private _aim(time: number, reckonStamp: number, out?: RewindView): RewindView {
    const newest = this._lastRecordedAt;
    const oldest = newest - this.defaultMaxRewindMs;
    // time<=0 → not synced yet → read live (newest). Else clamp into the window.
    const at = time <= 0 ? newest : (time < oldest ? oldest : time > newest ? newest : time);
    // lagComp:"reckon" types (schema-declared) display forward-extrapolated to
    // ≈ the client's serverNow — rewinding them to the raw snapshot stamp would
    // double-compensate (client extrapolates forward + server rewinds back = a
    // full-RTT ghost in the entity's past).
    let reckonAt: number;
    if (reckonStamp > 0) {
      // Direct stamp: read at exactly what the client displayed. The clamp is
      // the anti-spoof bound, same as the snapshot timeline's.
      reckonAt = reckonStamp < oldest ? oldest : reckonStamp > newest ? newest : reckonStamp;
    } else if (time <= 0) {
      reckonAt = newest;
    } else {
      // Reconstruction fallback (custom `at(time)` users / old clients): with
      // symmetric latency the client's instant is the midpoint of the stamp
      // and ARRIVAL — anchored at the bound "now" (the true processing
      // instant; the lastRecordedAt fallback is one tick stale by hit-test
      // time and biases the aim ~half a tick early — see bindNow). NOTE: the
      // stamp itself embeds the client's rtt/2 estimate, so this path inherits
      // its error — the direct stamp above is the accurate one.
      const anchor = this._nowOf !== undefined ? this._nowOf() : newest;
      const mid = (time + anchor) / 2;
      reckonAt = mid < oldest ? oldest : mid > newest ? newest : mid;
    }
    return (out ?? this._view)._retarget(this, at, reckonAt);
  }

  /**
   * A {@link RewindView} of the world as session `sessionId` LAST saw it —
   * resolves the render time stamped on that client's most recently CONSUMED
   * input (hence "last": under a multi-frame `drain()` it is the newest frame's
   * stamp) and hands off to {@link at}. This is the "what you see is what you
   * hit" path:
   *
   * ```ts
   * const seen = this.rewind.lastSeenBy(shooterSessionId);
   * const hit = overlaps(bullet, seen.value(target, "x"), seen.value(target, "y"));
   * ```
   *
   * Requires the room's input on the standard `input` slot with render-time
   * stamping on — `input = this.defineInput(Input, { renderTime: true })`
   * (declaration order vs `allowRewindState` doesn't matter). Misconfiguration
   * throws on first use instead of silently reading live positions; a client
   * that merely hasn't stamped yet (clock still syncing, unknown sessionId) is
   * NOT an error — it reads 0 and the view falls back to live. Use
   * {@link at} with an explicit time if you stamp render times yourself.
   *
   * Re-aims and returns this Rewind's internal view by default — zero alloc,
   * nothing to declare. Pass `out` to aim a view of your own instead; needed
   * only to hold several views at once — see the {@link RewindView} doc.
   */
  lastSeenBy(sessionId: string, out?: RewindView): RewindView {
    if (this._renderTimeOf === undefined) {
      throw new Error(
        "Rewind.lastSeenBy(sessionId) needs per-client render times. Enable them with " +
        "`defineInput(Input, { renderTime: true })`, or call `at(time)` and pass " +
        "the render time yourself.",
      );
    }
    return this._aim(
      this._renderTimeOf(sessionId),
      this._reckonTimeOf !== undefined ? this._reckonTimeOf(sessionId) : 0,
      out,
    );
  }
}

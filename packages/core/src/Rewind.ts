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
 *  -1 if unknown. Resolved ONCE per group (cold path), never per tick. */
function fieldIndexOf(instance: object, field: string): number {
  const md = (instance.constructor as any)[$METADATA] as Record<string, unknown> | undefined;
  const idx = md?.[field];
  return typeof idx === "number" ? idx : -1;
}

/**
 * Per-entity ring of recent field snapshots. `valueAt(time, col)` linearly
 * interpolates one field's recorded PATH to an arbitrary past time — reproducing
 * what the entity actually did (patrol bounces, a sine bob, teleport snaps),
 * which a velocity back-projection (`x - vx·dt`) can't for non-linear motion.
 */
class EntityHistory {
  readonly fields: readonly string[];
  private readonly cap: number;
  private readonly t: Float64Array;
  private readonly cols: Float64Array[];   // one column per field
  private head = 0;                         // next write slot
  private count = 0;

  constructor(fields: readonly string[], maxRewindMs: number, sampleIntervalMs: number) {
    this.fields = fields;
    this.cap = Math.max(2, Math.ceil(maxRewindMs / sampleIntervalMs) + 4);
    this.t = new Float64Array(this.cap);
    this.cols = fields.map(() => new Float64Array(this.cap));
  }

  /** `values` = the entity's dense `$values` array; `fieldIdx` = each tracked
   *  field's index into it. Direct array reads — no per-field megamorphic accessor. */
  record(time: number, values: ArrayLike<number>, fieldIdx: readonly number[]): void {
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
        const t0 = this.t[prev], t1 = this.t[idx];
        const a = t1 > t0 ? (time - t0) / (t1 - t0) : 0;
        return c[prev] + (c[idx] - c[prev]) * a;
      }
      prev = idx;
    }
    return c[newest];   // unreachable: `newest` guard above covers it
  }
}

interface TrackedGroup {
  entities: () => Iterable<object>;
  fields: readonly string[];
  fieldIdx: number[] | null;   // $values indices, resolved on first record
  maxRewindMs: number;
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
 *   this.setSimulationInterval((dt) => { ...move enemies... }, 1000 / 30);
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

  private constructor(defaultMaxRewindMs: number) { this.defaultMaxRewindMs = defaultMaxRewindMs; }

  /** The default rewind window (ms). Use it to bound a hit test:
   *  `Math.max(renderTime, now - rewind.maxRewindMs)`. */
  get maxRewindMs(): number { return this.defaultMaxRewindMs; }
  /** Server time of the last {@link record} (or -1). The auto-record skips a tick
   *  whose time was already recorded manually — your `record()` wins. */
  get lastRecordedAt(): number { return this._lastRecordedAt; }

  /** Track every entity in a collection (Map/Array/Set schema). `fields` narrows
   *  to its element's numeric fields. */
  attachAll<E extends object>(
    collection: Collection<E>,
    opts: { fields: readonly NumericKeys<E>[]; maxRewindMs?: number },
  ): this {
    const c = collection as unknown as { values(): Iterable<object> };
    this.groups.push({ entities: () => c.values(), fields: opts.fields, fieldIdx: null, maxRewindMs: opts.maxRewindMs ?? this.defaultMaxRewindMs });
    return this;
  }

  /** Track a single entity (e.g. a boss). `fields` narrows to its numeric fields. */
  attach<E extends object>(instance: E, opts: { fields: readonly NumericKeys<E>[]; maxRewindMs?: number }): this {
    const one: object[] = [instance];   // reused; no per-tick alloc
    this.groups.push({ entities: () => one, fields: opts.fields, fieldIdx: null, maxRewindMs: opts.maxRewindMs ?? this.defaultMaxRewindMs });
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
        if (g.fieldIdx === null) g.fieldIdx = g.fields.map((f) => fieldIndexOf(e, f));   // once
        let h = t[$HISTORY] as EntityHistory | undefined;
        if (h === undefined) { h = new EntityHistory(g.fields, g.maxRewindMs, this._sampleIntervalMs); t[$HISTORY] = h; }
        h.record(now, t[$VALUES] as ArrayLike<number>, g.fieldIdx);
      }
    }
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
}

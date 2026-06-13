import type { ClientPrivate } from '../Transport.ts';

/**
 * Names of fields on `I` whose values are `number` — used by
 * `Room.defineInput()` to constrain `seqField` to actually-numeric fields
 * on the input schema. Filters out booleans, strings, methods, etc.
 */
export type NumericFieldsOf<I> = {
  [K in keyof I]: I[K] extends number ? (K extends string ? K : never) : never;
}[keyof I];

/**
 * Context handed to the `idle` callback form — see {@link IdleInput}. A reused
 * per-client scratch: read it inside the callback, don't store it. It carries
 * MECHANISM only — derived judgments (e.g. liveness) stay in userland; look the
 * client up via `this.clients.getById(ctx.sessionId)` when your policy needs it.
 */
export interface IdleContext<I> {
  /** Last decoded input (`undefined` before the client's first). */
  latest: I | undefined;
  sessionId: string;
}

/**
 * What to synthesize when the buffer is empty (declared room-wide at
 * `defineInput({ idle })`, or per-call via {@link ConsumeOptions.idle}):
 * - `true` — pure schema defaults.
 * - `Partial<I>` — defaults overlaid with these fields. A full schema instance
 *   (e.g. {@link InputAccessor.latest}) also works — fields are copied BY NAME,
 *   so its prototype accessors are read correctly.
 * - callback — invoked LAZILY (only on an actually-empty tick) with an
 *   {@link IdleContext}, returning either of the above. The right form when the
 *   overrides take work to compute (entity lookups, held-button carry-over).
 *
 * ⚠ Do NOT build overrides by spreading a schema instance (`{ ...latest, x }`):
 * schema fields live on the prototype, so the spread copies NOTHING of them.
 * Return `latest` itself, or name the fields (`{ x, plant: !!latest?.plant }`).
 */
export type IdleInput<I> = true | Partial<I> | ((ctx: IdleContext<I>) => true | Partial<I>);

/**
 * Options for {@link InputAccessor.drain} / {@link InputAccessor.next}.
 * `idle` overrides the room-level `defineInput({ idle })` policy for this call
 * (see {@link IdleInput}); pass `false` to suppress it (force skip behavior).
 */
export interface ConsumeOptions<I> {
  idle?: IdleInput<I> | false;
}

/**
 * Input sanitization, declared at `defineInput({ sanitize })` — never trust the
 * wire. Applied to each decoded frame IN PLACE, before anything reads it
 * (`latest`, the buffer, the `idle` callback's ctx):
 * - **Map form** — per-field `[min, max]` range clamps with NaN-safe semantics:
 *   `NaN` (both comparisons false) lands on `min`, closing the classic
 *   `Math.min(NaN, …)` poisoning hole.
 * - **Callback form** — arbitrary in-place fix-up (wrap an angle, enforce a
 *   cross-field rule) for anything beyond ranges.
 *
 * Sanitizers MODIFY, they never reject — a malformed value becomes a legal one
 * instead of dropping the frame. Must not touch the `seqField` (it runs before
 * dedupe). Semantic validation ("slot must name an owned weapon") stays in
 * your sim — this handles value domains, not game rules.
 */
export type SanitizeInput<I> =
  | Partial<Record<NumericFieldsOf<I>, readonly [number, number]>>
  | ((input: I) => void);

/**
 * @internal Compile a {@link SanitizeInput} spec into the per-frame function the
 * decode path applies. The map form precompiles to dense min/max arrays walked
 * with the NaN-safe branch clamp; the callback form passes through.
 */
export function compileSanitizer<I>(spec: SanitizeInput<I>): (input: I) => void {
  if (typeof spec === 'function') { return spec; }
  const names = Object.keys(spec);
  const mins = new Float64Array(names.length);
  const maxs = new Float64Array(names.length);
  for (let i = 0; i < names.length; i++) {
    const range = (spec as Record<string, readonly [number, number]>)[names[i]]!;
    mins[i] = range[0];
    maxs[i] = range[1];
  }
  return (input: I) => {
    const inst = input as Record<string, number>;
    for (let i = 0; i < names.length; i++) {
      const v = inst[names[i]];
      // NaN-safe: NaN fails both comparisons → clamp floor.
      inst[names[i]] = v >= mins[i] ? (v <= maxs[i] ? v : maxs[i]) : mins[i];
    }
  };
}

const $METADATA: symbol = (Symbol as { metadata?: symbol }).metadata ?? Symbol.for("Symbol.metadata");

/** Field names of an input schema ctor, in declaration order (indices are dense
 *  from 0 in the metadata). Resolved ONCE per buffer (cold path). */
function fieldNamesOf(ctor: new () => any): string[] {
  const md = (ctor as any)[$METADATA] as Record<number, { name?: string }> | undefined;
  const names: string[] = [];
  if (md) {
    for (let i = 0; ; i++) {
      const f = md[i];
      if (!f || typeof f.name !== "string") break;
      names.push(f.name);
    }
  }
  return names;
}

/**
 * Internal: input configuration captured by `Room.defineInput()`. The schema
 * constructor is stored here so the runtime doesn't need to know it through
 * the public `room.input` (which is now a callable accessor).
 *
 * @internal
 */
export interface InputOptions {
  /**
   * Schema constructor used to allocate per-client input instances on join.
   * Captured by `defineInput()` from its `type` argument.
   *
   * Typed loosely (`new () => any`) to sidestep type-identity issues across
   * duplicate `@colyseus/schema` installs; the runtime calls
   * `instance.clone()` and friends, which match by shape.
   */
  ctor: new () => any;

  /**
   * Name of a monotonically-increasing numeric field on the input schema used
   * to order and dedupe incoming frames. Unset by default (opt-in) — dedupe and
   * `.at()` lookup are off unless you name a field here. When set, the framework:
   * - Drops redundant frames (`input[seqField]` ≤ the last-seen value are
   *   discarded before they enter the buffer) — the unreliable-mode
   *   ring-redundancy pattern.
   * - Powers `room.input(sessionId).at(value)` lookups.
   *
   * Despite the name, "seq" here is broader than an integer counter — any
   * monotonic numeric field works:
   * - **Sequence counter** (`"seq"`, `"tick"`, `"frame"`) — typical for
   *   lockstep / rollback netcode (Photon Quantum, GGPO).
   * - **Timestamp** (`"timestamp"`, milliseconds or seconds) — useful for
   *   variable-rate clients, lag compensation, hit registration (Unreal CMC
   *   uses float-seconds timestamps via `FSavedMove_Character.TimeStamp`).
   *
   * Whichever you use, the field must increase monotonically across frames
   * for dedupe to work.
   */
  seqField?: string;

  /**
   * > 0 enables per-client buffering of cloned snapshots — required for
   * `room.input(sessionId).drain() / .peek() / .at()` to return populated
   * data. Oldest drops on overflow. Set to `0` to disable (`.latest` still
   * works).
   */
  bufferMaxSize: number;

  /**
   * `true` when the Room called `defineInput(..., { renderTime: true })`.
   * The client then auto-stamps each reliable input with a server-clock render
   * timestamp (ms since room start), surfaced as {@link InputAccessor.renderTime}
   * for lag-compensated hit registration. Default `false`.
   */
  renderTime?: boolean;

  /**
   * Fixed step rate (Hz) advertised to clients via the join handshake; they
   * predict at dt = 1/tickRate. Set explicitly via `defineInput`, or derived
   * from `setTimestep`. Unset = not advertised.
   */
  tickRate?: number;

  /**
   * Physics sub-steps per input tick (integer ≥ 1) advertised to clients via
   * the join handshake — the simulation integrates `subSteps` engine steps of
   * `(1/tickRate)/subSteps` per input on BOTH sides, so physics runs at
   * `tickRate * subSteps` Hz on a `tickRate` input/network rate. Set via
   * `setFixedTimestep(..., { subSteps })` (or `defineInput`). Unset/1 = not
   * advertised (input rate == physics rate).
   */
  subSteps?: number;

  /**
   * Room-level absence policy: bare `drain()` / `next()` synthesize one idle
   * frame from it when a tick has no input. See {@link IdleInput}.
   */
  idle?: IdleInput<any>;

  /**
   * COMPILED sanitizer (see {@link SanitizeInput} / {@link compileSanitizer}) —
   * applied in place to each decoded frame before it becomes visible to
   * `latest` / the buffer / the idle ctx.
   */
  sanitize?: (instance: any) => void;
}

/**
 * Per-client input accessor returned by `room.input(sessionId)`. Combines the
 * latest decoded instance with the (optional) snapshot ring buffer.
 *
 * - {@link latest} — the bound Schema instance, mutated in place by the
 *   decoder. Cheapest read; use when only the most recent state matters.
 * - {@link drain} / {@link next} / {@link take} / {@link peek} / {@link at} —
 *   populated when `defineInput()` was called with `bufferMaxSize > 0`
 *   (default 32). Use for rollback netcode / lockstep where every frame matters.
 *
 * **Per-entity vs shared world** — pick the consume primitive by who integrates:
 * - **Per-entity** (each body integrates itself): {@link drain} all of a
 *   player's inputs and sub-integrate one per input — N inputs = N steps for
 *   that player, ack lands on the newest applied. The clean default.
 * - **Shared world** (one solver step advances every body together): you can't
 *   replay N inputs as N world steps without over-stepping everyone else, so
 *   {@link next} exactly one input per entity per tick (or {@link take} a bounded
 *   few and sub-step the solver per input). The ack then === inputs actually
 *   simulated; `drain()`-then-apply-latest would silently jump the ack past
 *   inputs the server never simulated, snapping the client's reconciler.
 *
 * Returned for unknown sessionIds and rooms without `defineInput()` is a
 * frozen no-op accessor (latest=undefined, drain/next/take/peek=[]/undefined,
 * at=undefined, size=0, clear=no-op).
 *
 * `Idle` is `true` when the room declared `defineInput({ idle })` — it narrows
 * {@link next} to non-optional `I` (bare calls always yield a frame).
 */
export interface InputAccessor<I = any, Idle extends boolean = false> {
  /** Latest decoded input. `undefined` when unknown sessionId or no input declared. */
  readonly latest: I | undefined;

  /**
   * Find the buffered snapshot whose `[seqField]` equals `value`. The field
   * name is the Room's `defineInput()` `seqField`. Linear scan — cheap for
   * typical buffer sizes; not intended for very large rings. Returns
   * `undefined` when no match is buffered (or `seqField` isn't configured).
   *
   * Useful for tick-aligned retrieval (lockstep, rollback).
   */
  at(value: number): I | undefined;

  /**
   * Take everything buffered (oldest → newest) and clear. Snapshots are safe to retain.
   *
   * With a room-level `defineInput({ idle })` policy the result is TOTAL: an
   * empty tick yields one synthesized "idle" frame instead of `[]`, so the sim
   * loop needs no empty-branch (gravity still integrates, action guards
   * naturally no-op on default values). The synthesized frame is the schema's
   * DEFAULTS overlaid with the policy's overrides (see {@link IdleInput}):
   *
   * ```ts
   * // declared once at defineInput({ idle: (ctx) => ({ ... }) }); then simply:
   * for (const f of inputCh.drain()) {
   *   stepPlayer(p, f, world);          // ≥1 frame, always
   *   if (f.fire) tryFire(...);         // idle frame: fire=false → no-op
   * }
   * ```
   *
   * Pass `{ idle }` to override the room policy for this call, or
   * `{ idle: false }` to suppress it.
   *
   * The idle frame is NOT a consumed input: it advances neither the reconcile
   * ack (`consumedCount`) nor {@link renderTime}. It is ONE reused instance per
   * client, refilled on each synthesis — read it within the tick, don't store
   * it. No synthesis for unknown sessionIds or `bufferMaxSize: 0`.
   */
  drain(opts?: ConsumeOptions<I>): I[];

  /**
   * Consume the single oldest buffered input and advance the reconcile ack by
   * exactly one — the complement to {@link peek}. Returns `undefined`
   * when the buffer is empty.
   *
   * Use this in a **shared-world** loop where one solver step advances every
   * entity together: you can't apply N-inputs-per-player as N world steps without
   * over-stepping the others, so consume one input per entity per fixed step
   * instead. {@link drain} (consume all, ack jumps to newest) is correct only
   * when each entity integrates ITSELF — see the {@link InputAccessor} docs.
   *
   * `consumedCount`/{@link renderTime} stay exact: the ack reflects only the
   * inputs you actually simulated, and `renderTime` is the stamp of THIS input.
   *
   * With a room-level `defineInput({ idle })` policy (or a per-call `{ idle }`
   * override) an empty tick returns a synthesized frame instead of `undefined`
   * — same contract as {@link drain}'s. A "held key keeps moving through a
   * packet gap" loop:
   *
   * @example
   * ```ts
   * // declared once:
   * input = this.defineInput(InputSchema, {
   *   idle: ({ latest }) => latest ?? true,   // empty tick → last input verbatim
   * });
   * // per tick:
   * this.setFixedTimestep(() => {
   *   for (const [sid, body] of bodies) {
   *     applyInputToBody(body, this.input(sid).next());   // typed I — never undefined
   *   }
   *   world.step();                                       // one step for everyone
   * }, 30);
   * ```
   */
  next(): Idle extends true ? I : I | undefined;
  next(opts: { idle: IdleInput<I> }): I;
  next(opts?: ConsumeOptions<I>): I | undefined;

  /**
   * Consume up to `n` oldest buffered inputs (oldest → newest) and advance the
   * reconcile ack by the count actually taken. Returns fewer than `n` (or `[]`)
   * when the buffer holds fewer. Use for shared-world **sub-stepping** — apply
   * each taken input as its own solver sub-step within one tick, bounding the
   * sub-steps per tick. {@link next} is the `take(1)` shorthand.
   */
  take(n: number): I[];

  /** Read everything buffered without consuming. */
  peek(): I[];

  /** Number of snapshots currently buffered. */
  readonly size: number;

  /** Drop all buffered snapshots (also resets the dedupe tracker). */
  clear(): void;

  /**
   * Server-clock render timestamp (ms since room start) of the most recently
   * consumed input — the time the client was rendering the world at when it
   * issued that input. Tracks the consume primitive: {@link drain}/{@link take}
   * report the NEWEST input they consumed; {@link next} reports THAT one input,
   * so single-consume loops rewind to the exact instant of the input simulated.
   * `0` until the first render-time-stamped input is consumed. Populated only
   * when the Room called `defineInput(..., { renderTime: true })` with
   * `bufferMaxSize > 0`. Usually you don't read this directly — pass the
   * sessionId to `rewind.lastSeenBy(sessionId)` (which resolves this value, clamps
   * it, and falls back to live) for lag-compensated "what you see is what you
   * hit" hit registration; use this getter only for a custom rewind time.
   */
  readonly renderTime: number;

  /**
   * Reckon-display stamp (server-clock ms) of the most recently consumed input
   * — the client's serverNow ESTIMATE when it sampled that input, i.e. the
   * exact instant its forward-reckoned (`lagComp:"reckon"`) entities were
   * displayed at. Stamping the display instant DIRECTLY makes the rewind read
   * immune to the client's RTT-estimation error: the client displayed
   * `f(serverNow_est)` and the server reads `f(serverNow_est)` — the same
   * index into the same recorded timeline, so estimation error cancels (the
   * `maxRewindMs` clamp still bounds spoofing). Same consume semantics as
   * {@link renderTime}; consumed automatically by `rewind.lastSeenBy()` —
   * rarely read directly. `0` until stamped (→ rewind falls back to the
   * midpoint reconstruction).
   */
  readonly reckonTime: number;
}

/**
 * Callable returned by `Room.defineInput()`. Assign it to `this.input` and
 * call `room.input(sessionId)` per tick to read each client's latest input
 * and/or buffered snapshots.
 *
 * The fixed-step metadata lives HERE (one per room), not on the per-client
 * `InputAccessor` — these values are identical for every client, so they'd be
 * pure duplication per connection.
 */
export type InputAPI<I = any, Idle extends boolean = false> = ((sessionId: string) => InputAccessor<I, Idle>) & {
  /**
   * Server-advertised fixed step rate in **Hz** — from `defineInput`'s
   * `tickRate`/`stepMs`/`stepSeconds`, or derived from `setTimestep` —
   * the same value cascaded to predicting clients. `undefined` when no fixed
   * step is advertised.
   */
  readonly tickRate?: number;
  /**
   * The fixed step as **seconds** (`1/tickRate`): the dt to integrate one input
   * with, bit-identical to the client's prediction dt. Pass it to your physics
   * step (`applyInput(p, cmd, level, room.input.stepSeconds)`) so server and
   * client share one timestep instead of each keeping a constant that can drift.
   * `undefined` when no rate is advertised.
   */
  readonly stepSeconds?: number;
  /** The fixed step as **milliseconds** (`1000/tickRate`). `undefined` when no rate. */
  readonly stepMs?: number;
  /** Physics sub-steps per input tick (≥ 1; `1` unless declared via
   *  `setFixedTimestep(..., { subSteps })` / `defineInput`). */
  readonly subSteps: number;
  /** The physics sub-step as **seconds** (`stepSeconds / subSteps`) — the engine
   *  dt when sub-stepping; equals {@link stepSeconds} when `subSteps` is 1.
   *  `undefined` when no rate is advertised. */
  readonly subStepSeconds?: number;
  /** The physics sub-step as **milliseconds** (`stepMs / subSteps`). `undefined`
   *  when no rate is advertised. */
  readonly subStepMs?: number;
};

/** @internal */
export class InputBufferImpl<I = any> {
  private _items: I[] = [];
  private _lastSeq: number = -Infinity;
  private readonly _maxSize: number;
  private readonly _seqField: string | undefined;

  /**
   * Cumulative count of inputs CONSUMED from this buffer (via {@link drain} or
   * {@link clear}). Consumed = "removed from the pending set" — whether applied
   * to state or discarded. The server echoes this in the TIMED prefix as the
   * reconciliation ack: it tracks how many of the client's inputs are reflected
   * in (or finished influencing) the authoritative state, which lags the
   * receive counter by inputs still buffered. Distinct from `_receivedInputCount`
   * (receive-time, for RTT), which leads the state and is wrong for reconcile.
   */
  consumedCount = 0;

  /** Render times parallel to `_items` (server-clock ms; `0` when unset). */
  private _renderTimes: number[] = [];
  /** Render time of the most recently drained input (see {@link renderTime}). */
  private _lastRenderTime = 0;
  /** Reckon-display stamps parallel to `_items` — the client's serverNow
   *  estimate at input-sample time, i.e. the instant its forward-reckoned
   *  entities were displayed at (server-clock ms; `0` when unset). */
  private _reckonTimes: number[] = [];
  /** Reckon stamp of the most recently consumed input (see {@link reckonTime}). */
  private _lastReckonTime = 0;

  /** Input schema ctor — mints the reused idle frame; idle is off without it. */
  private readonly _ctor?: new () => I;
  /** Client slice this buffer belongs to (the live object is `Client & ClientPrivate`)
   *  — feeds the idle callback's ctx (latest + sessionId). */
  private readonly _client?: Pick<ClientPrivate, '_input'> & { sessionId: string };
  /** Room-level idle policy (`defineInput({ idle })`) — the bare-call default. */
  private readonly _roomIdle?: IdleInput<I>;
  /** Reused synthesized idle frame + the schema's field names/defaults (lazy). */
  private _idle?: I;
  private _fieldNames?: string[];
  private _defaults?: unknown[];
  /** Reused ctx for the idle callback form (see {@link IdleContext}). */
  private readonly _idleCtx: IdleContext<I> = { latest: undefined, sessionId: "" };

  constructor(maxSize: number, seqField: string | undefined, ctor?: new () => I, client?: Pick<ClientPrivate, '_input'> & { sessionId: string }, idle?: IdleInput<I>) {
    this._maxSize = maxSize;
    this._seqField = seqField;
    this._ctor = ctor;
    this._client = client;
    this._roomIdle = idle;
  }

  /** The effective idle policy for one consume call: per-call `false` suppresses,
   *  per-call value overrides, else the room-level default (or none). */
  private effectiveIdle(opts?: ConsumeOptions<I>): IdleInput<I> | undefined {
    return opts?.idle === false ? undefined : (opts?.idle ?? this._roomIdle);
  }

  /** Resolve an {@link IdleInput} to overrides — invokes the callback form
   *  LAZILY, here at synthesis time (the buffer is known to be empty). */
  private resolveIdle(idle: IdleInput<I>): true | Partial<I> {
    if (typeof idle !== "function") return idle;
    this._idleCtx.latest = this._client?._input as I | undefined;
    this._idleCtx.sessionId = this._client?.sessionId ?? "";
    return idle(this._idleCtx) ?? true;
  }

  /**
   * The synthesized "no input this tick" frame: schema defaults overlaid with
   * `overrides` (`true` = none). Copies BY FIELD NAME from the schema metadata —
   * schema fields are prototype accessors (no own props), so `Object.assign`
   * can't source from a schema instance; the name walk reads getters, letting
   * `overrides` be a plain partial OR a schema instance (e.g. `latest`).
   * ONE reused instance — refilled per call, never advances the ack.
   */
  private idleFrame(overrides: true | Partial<I>): I {
    if (this._idle === undefined) {
      // Lazy mint (cold): the fresh instance doubles as the defaults source.
      this._idle = new this._ctor!();
      this._fieldNames = fieldNamesOf(this._ctor!);
      const fresh = this._idle as Record<string, unknown>;
      this._defaults = this._fieldNames.map((n) => fresh[n]);
    }
    const idle = this._idle as Record<string, unknown>;
    const names = this._fieldNames!;
    const defaults = this._defaults!;
    const ov = overrides === true ? undefined : (overrides as Record<string, unknown>);
    for (let i = 0; i < names.length; i++) {
      const v = ov?.[names[i]];
      idle[names[i]] = v !== undefined ? v : defaults[i];
    }
    return this._idle;
  }

  push(snapshot: I, renderTime: number = 0, reckonTime: number = 0): void {
    this._items.push(snapshot);
    this._renderTimes.push(renderTime);
    this._reckonTimes.push(reckonTime);
    // Overflow drops oldest unconsumed input; count it consumed so the reconcile ack still advances past it.
    if (this._items.length > this._maxSize) {
      this._items.shift();
      this._renderTimes.shift(); // keep parallel with `_items`
      this._reckonTimes.shift();
      this.consumedCount++;
    }
  }

  /** Returns true if `value` hasn't been seen, and updates the last-seen marker. */
  accept(value: number): boolean {
    if (value <= this._lastSeq) { return false; }
    this._lastSeq = value;
    return true;
  }

  drain(opts?: ConsumeOptions<I>): I[] {
    // Idle synthesis (empty + a policy in effect): NOT a consumed input — no ack
    // bump, renderTime untouched (lastSeenBy keeps resolving the real last stamp).
    if (this._items.length === 0 && this._ctor !== undefined) {
      const idle = this.effectiveIdle(opts);
      if (idle !== undefined) return [this.idleFrame(this.resolveIdle(idle))];
    }
    const out = this._items;
    // Report newest drained input's stamps; persist across a subsequent empty drain.
    if (this._renderTimes.length > 0) {
      this._lastRenderTime = this._renderTimes[this._renderTimes.length - 1];
      this._lastReckonTime = this._reckonTimes[this._reckonTimes.length - 1];
    }
    this.consumedCount += out.length;
    this._items = [];
    this._renderTimes = [];
    this._reckonTimes = [];
    return out;
  }

  /** Consume the single oldest input (ack advances by one); `undefined` if
   *  empty — or the synthesized idle frame when `opts.idle` is given. */
  next(opts?: ConsumeOptions<I>): I | undefined {
    if (this._items.length === 0) {
      const idle = this._ctor !== undefined ? this.effectiveIdle(opts) : undefined;
      return idle !== undefined ? this.idleFrame(this.resolveIdle(idle)) : undefined;
    }
    this._lastRenderTime = this._renderTimes.shift()!; // stamps of THIS input
    this._lastReckonTime = this._reckonTimes.shift()!;
    this.consumedCount++;
    return this._items.shift();
  }

  /** Consume up to `n` oldest inputs (ack advances by the count actually taken). */
  take(n: number): I[] {
    if (n <= 0 || this._items.length === 0) { return []; }
    const count = Math.min(n, this._items.length);
    const out = this._items.splice(0, count);
    const times = this._renderTimes.splice(0, count);
    const reckons = this._reckonTimes.splice(0, count);
    this._lastRenderTime = times[times.length - 1]; // newest taken input's stamps
    this._lastReckonTime = reckons[reckons.length - 1];
    this.consumedCount += count;
    return out;
  }

  peek(): I[] {
    return this._items.slice();
  }

  at(value: number): I | undefined {
    if (this._seqField === undefined) { return undefined; }
    for (let i = 0; i < this._items.length; i++) {
      if ((this._items[i] as any)[this._seqField] === value) { return this._items[i]; }
    }
    return undefined;
  }

  get size(): number {
    return this._items.length;
  }

  /** Render time (server-clock ms) of the most recently drained input; `0`
   *  until the first render-time-stamped input is drained. */
  get renderTime(): number {
    return this._lastRenderTime;
  }

  /** Reckon-display stamp of the most recently consumed input — the client's
   *  serverNow estimate when it sampled that input, i.e. the EXACT instant its
   *  forward-reckoned entities were displayed at. Same consume semantics as
   *  {@link renderTime}. Consumed automatically by `rewind.lastSeenBy()` for
   *  `lagComp:"reckon"` types — rarely read directly. `0` until stamped. */
  get reckonTime(): number {
    return this._lastReckonTime;
  }

  clear(): void {
    this.consumedCount += this._items.length;
    this._items.length = 0;
    this._renderTimes.length = 0;
    this._reckonTimes.length = 0;
    this._lastSeq = -Infinity;
  }
}

/**
 * Default per-client accessor. Reads `_input` and `_inputBuffer` off the
 * client at access time — both are nullable until the room declares input
 * via `defineInput()`. Cached as `client._inputAccessor` at join, so
 * `room.input(sessionId)` is a Map lookup + property read.
 *
 * @internal
 */
export class InputAccessorImpl<I = any> implements InputAccessor<I> {
  private _client: ClientPrivate;
  constructor(client: ClientPrivate) { this._client = client; }
  get latest(): I | undefined { return this._client._input as I | undefined; }
  at(value: number): I | undefined { return this._client._inputBuffer?.at(value) as I | undefined; }
  drain(opts?: ConsumeOptions<I>): I[] { return (this._client._inputBuffer?.drain(opts) ?? []) as I[]; }
  next(): I | undefined;
  next(opts: { idle: IdleInput<I> }): I;
  next(opts?: ConsumeOptions<I>): I | undefined { return this._client._inputBuffer?.next(opts) as I | undefined; }
  take(n: number): I[] { return (this._client._inputBuffer?.take(n) ?? []) as I[]; }
  peek(): I[] { return (this._client._inputBuffer?.peek() ?? []) as I[]; }
  get size(): number { return this._client._inputBuffer?.size ?? 0; }
  clear(): void { this._client._inputBuffer?.clear(); }
  get renderTime(): number { return this._client._inputBuffer?.renderTime ?? 0; }
  get reckonTime(): number { return this._client._inputBuffer?.reckonTime ?? 0; }
}

/**
 * Returned by `room.input(sessionId)` for unknown sessions and for rooms
 * that didn't call `defineInput()`.
 *
 * @internal
 */
export const NO_OP_INPUT_ACCESSOR: InputAccessor<any> = Object.freeze({
  latest: undefined,
  at: () => undefined,
  drain: () => [],
  next: () => undefined,
  take: () => [],
  peek: () => [],
  size: 0,
  clear: () => {},
  renderTime: 0,
  reckonTime: 0,
});

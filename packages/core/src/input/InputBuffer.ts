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
 * client up via `this.clients.get(ctx.sessionId)` when your policy needs it.
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
 * the public `room.inputs` (the `.get(sessionId)` accessor).
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
   * - Powers `room.inputs.get(sessionId).at(value)` lookups.
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
   * `room.inputs.get(sessionId).drain() / .peek() / .at()` to return populated
   * data. Oldest drops on overflow. Set to `0` to disable (`.latest` still
   * works).
   */
  bufferMaxSize: number;

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
 * Per-client input accessor returned by `room.inputs.get(sessionId)`. Combines the
 * latest decoded instance with the (optional) snapshot ring buffer.
 *
 * - {@link latest} — the bound Schema instance, mutated in place by the
 *   decoder. Cheapest read; use when only the most recent state matters.
 * - {@link consume} / `for (const inp of accessor)` / {@link drain} /
 *   {@link next} / {@link take} / {@link peek} / {@link at} — populated when
 *   `defineInput()` was called with `bufferMaxSize > 0` (default 32). Use for
 *   rollback netcode / lockstep where every frame matters.
 *
 * **Per-entity vs shared world** — pick the consume primitive by who integrates:
 * - **Per-entity** (each body integrates itself): iterate the accessor —
 *   `for (const inp of this.inputs.get(sid))` (sugar for {@link consume}) — and
 *   sub-integrate one per input. N inputs = N steps for that player, ack lands
 *   on the newest applied. The clean default. Iterating consumes ONE AT A TIME,
 *   so {@link renderTime} tracks each input (lag comp stays exact per step) and
 *   `break` leaves the rest buffered. {@link drain} returns the same set as an
 *   array (retainable), but reports only the newest input's {@link renderTime}.
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
   * The blessed **per-entity** loop: consume each pending input oldest → newest,
   * ONE AT A TIME. Unlike {@link drain} (which reports only the newest input's
   * stamps up front), iterating updates {@link renderTime}/{@link reckonTime} and
   * advances {@link consumedCount} per yielded input — so per-step lag comp
   * rewinds to the exact instant of the input being applied:
   *
   * ```ts
   * for (const inp of this.inputs.get(sid)) {   // sugar: accessor is iterable
   *   applyInput(p, inp, dt);
   *   this.collide(sid, p);                // renderTime === THIS input's stamp
   *   if (!p.alive) break;                 // break leaves the rest buffered
   * }
   * ```
   *
   * When the buffer is empty and an `idle` policy is in effect (room-level, or
   * per-call `opts.idle`), yields EXACTLY ONE idle frame (not consumed: no ack
   * bump, no {@link renderTime} change, {@link wasIdle} === true) then stops. No
   * policy + empty → zero iterations. Unknown sessionId / `bufferMaxSize: 0` →
   * empty. `for (const inp of accessor)` is `consume()` with no opts.
   *
   * The returned iterator is POOLED (reused per call, allocation-free). For
   * `for..of` / spread / `Array.from` this is invisible. If you drive it by hand,
   * iterate it once to completion (or call `.return()` / `break`) before the next
   * `consume()`, and read each `.next()` result before the next — don't retain or
   * compare result objects. (Nesting two `consume()` loops over the SAME channel
   * is handled safely but is meaningless — both share one cursor.)
   */
  consume(opts?: ConsumeOptions<I>): IterableIterator<I>;

  /** Iterate pending (and/or one idle) inputs — sugar for {@link consume}(). */
  [Symbol.iterator](): IterableIterator<I>;

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
   * for (const f of this.inputs.get(sid).drain()) {
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
   * inputs = this.defineInput(InputSchema, {
   *   idle: ({ latest }) => latest ?? true,   // empty tick → last input verbatim
   * });
   * // per tick:
   * this.setFixedTimestep(() => {
   *   for (const [sid, body] of bodies) {
   *     applyInputToBody(body, this.inputs.get(sid).next());   // typed I — never undefined
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

  /**
   * Cumulative count of this client's inputs CONSUMED so far — the reconcile ack
   * echoed back to the client (its `lastProcessed`). Advances by one per
   * {@link next}, by the count taken per {@link take}/{@link drain}, by one per
   * yield while iterating {@link consume}, and on overflow-drop; a synthesized
   * idle frame NEVER advances it. Monotonic, so it doubles as a server-side input
   * seq — gate per-input actions off it (e.g. a fire cooldown counted in inputs)
   * instead of hand-rolling a counter. `0` before the first consume / for the
   * no-op accessor.
   */
  readonly consumedCount: number;

  /**
   * `true` when the most recently produced frame was a synthesized idle (vs a
   * real consumed input) — the "skip work on idle" guard. Set per consume
   * call/yield: `true` after a {@link next}/{@link consume}/{@link drain} that
   * fell back to the `idle` policy on an empty buffer, `false` after a real
   * input. Always `false` for {@link take} (never synthesizes) and the no-op
   * accessor. Reads meaningfully right after the consume that produced the frame.
   */
  readonly wasIdle: boolean;

  /** Drop all buffered snapshots (also resets the dedupe tracker). */
  clear(): void;

  /**
   * Server-clock render timestamp (ms since room start) of the most recently
   * consumed input — the time the client was rendering the world at when it
   * issued that input. Tracks the consume primitive: {@link drain}/{@link take}
   * report the NEWEST input they consumed; {@link next} and each
   * {@link consume}/`for..of` yield report THAT one input, so per-input loops
   * rewind to the exact instant of the input simulated.
   * `0` until the first render-time-stamped input is consumed. Populated only
   * when the room rewinds a `mode:"snapshot"` group (which auto-enables the
   * renderTime stamp) and `bufferMaxSize > 0`. Usually you don't read this
   * directly — pass the
   * sessionId to `rewind.lastSeenBy(sessionId)` (which resolves this value, clamps
   * it, and falls back to live) for lag-compensated "what you see is what you
   * hit" hit registration; use this getter only for a custom rewind time.
   */
  readonly renderTime: number;

  /**
   * Reckon-display stamp (server-clock ms) of the most recently consumed input
   * — the client's serverNow ESTIMATE when it sampled that input, i.e. the
   * exact instant its forward-reckoned (`mode:"reckon"`) entities were
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
 * Returned by `Room.defineInput()`. Assign it to `this.inputs`, then call
 * `room.inputs.get(sessionId)` per tick to read each client's input stream —
 * the same per-session lookup verb as `room.clients.get(sessionId)`.
 *
 * The fixed-step metadata lives HERE (one per room), not on the per-client
 * {@link InputAccessor} — these values are identical for every client, so they'd
 * be pure duplication per connection. `.get()` keeps the accessor and this
 * metadata cleanly separated.
 */
export type InputAPI<I = any, Idle extends boolean = false> = {
  /**
   * The input accessor for `sessionId` — the per-client stream you iterate /
   * `.next()` / `.drain()`. Returns a frozen no-op accessor for unknown sessions.
   * Mirrors `room.clients.get(sessionId)`.
   */
  get(sessionId: string): InputAccessor<I, Idle>;
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
   * step (`applyInput(p, cmd, level, room.inputs.stepSeconds)`) so server and
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

/** Reclaim the consumed prefix once the read cursor passes this many items —
 *  bounds the parallel arrays' slack to O(THRESHOLD) between compactions while
 *  keeping per-consume work O(1) (no `shift()` re-index on every input). */
const COMPACT_THRESHOLD = 32;

/** Shared zero-state "already done" iterator — returned by `consume()` on an
 *  empty buffer with no idle policy, and by the no-op accessor. Frozen + a frozen
 *  result, so it's allocation-free and safe to share across all callers. */
const DONE_RESULT: IteratorResult<any> = Object.freeze({ value: undefined, done: true });
const DONE_ITERATOR: IterableIterator<any> = Object.freeze({
  [Symbol.iterator]() { return this; },
  next() { return DONE_RESULT; },
});

/** @internal */
export class InputBufferImpl<I = any> {
  /** Pending snapshots, indexed `[_head, _items.length)`. Consumed inputs are
   *  NOT spliced off per-read — `_head` advances and the prefix is reclaimed in
   *  bulk by {@link compact} (a `shift()` per read is O(n), so a burst would be
   *  O(n²)). `_renderTimes`/`_reckonTimes` stay parallel to `_items`. */
  private _items: I[] = [];
  /** Read cursor: index of the oldest UNCONSUMED input (== `_items.length` when empty). */
  private _head = 0;
  private _lastSeq: number = -Infinity;
  private readonly _maxSize: number;
  private readonly _seqField: string | undefined;

  /**
   * Cumulative count of inputs CONSUMED from this buffer (via any consume
   * primitive — {@link next}/{@link take}/{@link drain}/{@link consume} — plus
   * {@link clear} and overflow). Consumed = "removed from the pending set",
   * whether applied to state or discarded. The server echoes this in the TIMED
   * prefix as the reconciliation ack: how many of the client's inputs are
   * reflected in (or finished influencing) the authoritative state, which lags
   * the receive counter by inputs still buffered. Distinct from
   * `_receivedInputCount` (receive-time, for RTT), which leads the state.
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
  /** Framework wire seq per buffered input (parallel to `_items`) — UNRELIABLE
   *  ONLY, lazily created on the first seq-carrying push. Reliable inputs are
   *  contiguous, so their consumed-seq-value is always exactly {@link consumedCount}
   *  and needs no parallel array; `undefined` here marks that (the common, default
   *  path pays nothing). A buffer is single-mode, so this is either never created
   *  (reliable) or created once and kept parallel (unreliable). */
  private _seqs?: number[];
  /** Seq VALUE of the last consumed input — the reconciliation ack echoed to the
   *  client (see {@link ackSeq}). Only meaningful when {@link _seqs} is tracked
   *  (unreliable); reliable's ack falls back to {@link consumedCount}. */
  private _lastConsumedSeq = 0;
  /** Whether the most recently produced frame was a synthesized idle (see {@link wasIdle}). */
  private _lastWasIdle = false;

  /** Reused {@link consume} iterator (lazily minted) + its per-call state, so a
   *  per-tick loop allocates no generator frame. `_iterEnd` snapshots the count
   *  to walk; `_iterIdle` is an optional trailing synthesized frame; `_iterActive`
   *  guards against a nested consume() clobbering the shared `_iterRes`. */
  private _iter?: IterableIterator<I>;
  private _iterEnd = 0;
  private _iterActive = false;
  private _iterIdle?: I;
  private readonly _iterRes: { value: I | undefined; done: boolean } = { value: undefined, done: false };

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

  /** The idle frame to synthesize on an empty tick (room policy or per-call
   *  `opts.idle`), or `undefined` when no policy is in effect. Reuses the single
   *  idle instance; never advances the ack. Callers set {@link wasIdle}. */
  private idleFrameOnEmpty(opts?: ConsumeOptions<I>): I | undefined {
    const idle = this._ctor !== undefined ? this.effectiveIdle(opts) : undefined;
    return idle === undefined ? undefined : this.idleFrame(this.resolveIdle(idle));
  }

  /** Consume the input at the cursor: advance cursor + ack, stamp THIS input's
   *  render/reckon times, clear {@link wasIdle}. The shared per-input step behind
   *  {@link next}, {@link consume}'s iterator, and the re-entrant fallback. */
  private stepHead(): I {
    const i = this._head;
    this._lastWasIdle = false;
    this._lastRenderTime = this._renderTimes[i];
    this._lastReckonTime = this._reckonTimes[i];
    if (this._seqs !== undefined) { this._lastConsumedSeq = this._seqs[i]; }
    this._head = i + 1;
    this.consumedCount++;
    return this._items[i];
  }

  /** Drop ALL slots, reusing the backing arrays' capacity — the zero-GC reset for
   *  the consume/next path ({@link compact}/{@link clear}). `drain()` deliberately
   *  does NOT use this (it returns an array, so fresh `[]` is faster there). */
  private truncate(): void {
    this._items.length = 0;
    this._renderTimes.length = 0;
    this._reckonTimes.length = 0;
    if (this._seqs !== undefined) { this._seqs.length = 0; }
    this._head = 0;
  }

  /**
   * Append a decoded input snapshot. `seq` is the framework wire seq (unreliable);
   * omit it for reliable inputs, which get an implicit monotonic receive count so
   * {@link ackSeq} stays well-defined in both modes.
   */
  push(snapshot: I, renderTime: number = 0, reckonTime: number = 0, seq?: number): void {
    this._items.push(snapshot);
    this._renderTimes.push(renderTime);
    this._reckonTimes.push(reckonTime);
    // Track the wire seq only for unreliable (seq provided); reliable derives its
    // ack from consumedCount, so it never allocates/maintains this array.
    if (seq !== undefined) { (this._seqs ??= []).push(seq); }
    // Overflow drops the oldest unconsumed input; count it consumed so the ack
    // still advances past it. Advance the cursor (don't shift) — keeps it O(1).
    if (this.size > this._maxSize) {
      if (this._seqs !== undefined) { this._lastConsumedSeq = this._seqs[this._head]; } // dropped oldest counts as acked
      this._head++;
      this.consumedCount++;
      this.compact();
    }
  }

  /** Reclaim the consumed prefix `[0, _head)`. Free when fully drained (reuse the
   *  arrays); otherwise splice only once the cursor passes {@link COMPACT_THRESHOLD},
   *  so the amortized per-input cost stays O(1). */
  private compact(): void {
    if (this._head === 0) { return; }
    if (this._head >= this._items.length) {
      this.truncate();
    } else if (this._head >= COMPACT_THRESHOLD) {
      this._items.splice(0, this._head);
      this._renderTimes.splice(0, this._head);
      this._reckonTimes.splice(0, this._head);
      if (this._seqs !== undefined) { this._seqs.splice(0, this._head); }
      this._head = 0;
    }
  }

  /** Returns true if `value` hasn't been seen, and updates the last-seen marker. */
  accept(value: number): boolean {
    if (value <= this._lastSeq) { return false; }
    this._lastSeq = value;
    return true;
  }

  drain(opts?: ConsumeOptions<I>): I[] {
    // Empty: synthesize one idle frame (NOT consumed — no ack bump, stamps
    // untouched) when a policy is in effect, else [].
    if (this.size === 0) {
      const idle = this.idleFrameOnEmpty(opts);
      this._lastWasIdle = idle !== undefined;
      return idle !== undefined ? [idle] : [];
    }
    this._lastWasIdle = false;
    const last = this._items.length - 1;
    this._lastRenderTime = this._renderTimes[last]; // drain reports the NEWEST stamps
    this._lastReckonTime = this._reckonTimes[last];
    if (this._seqs !== undefined) { this._lastConsumedSeq = this._seqs[last]; }
    // Hand off the backing array untouched when nothing was partially consumed
    // (O(1) — the caller may retain it); else copy out the unconsumed tail. Fresh
    // arrays here, NOT truncate(): drain already allocates the returned array, and
    // V8 makes `= []` + refill cheaper than `length = 0` reuse (~1.8× at small N),
    // so the speed wins and the 3 tiny empties are negligible next to the return.
    const out = this._head === 0 ? this._items : this._items.slice(this._head);
    this.consumedCount += out.length;
    this._items = [];
    this._renderTimes = [];
    this._reckonTimes = [];
    if (this._seqs !== undefined) { this._seqs = []; }
    this._head = 0;
    return out;
  }

  /** Consume the single oldest input (ack advances by one); `undefined` if
   *  empty — or the synthesized idle frame when an idle policy is in effect. */
  next(opts?: ConsumeOptions<I>): I | undefined {
    if (this.size === 0) {
      const idle = this.idleFrameOnEmpty(opts);
      this._lastWasIdle = idle !== undefined;
      return idle;
    }
    const item = this.stepHead();
    this.compact();
    return item;
  }

  /** Consume up to `n` oldest inputs (ack advances by the count actually taken). */
  take(n: number): I[] {
    this._lastWasIdle = false; // take never synthesizes idle
    const avail = this.size;
    if (n <= 0 || avail === 0) { return []; }
    const count = Math.min(n, avail);
    const start = this._head;
    const out = this._items.slice(start, start + count);
    this._lastRenderTime = this._renderTimes[start + count - 1]; // newest taken input's stamps
    this._lastReckonTime = this._reckonTimes[start + count - 1];
    if (this._seqs !== undefined) { this._lastConsumedSeq = this._seqs[start + count - 1]; }
    this._head += count;
    this.consumedCount += count;
    this.compact();
    return out;
  }

  /**
   * Iterate pending inputs one at a time (per-yield ack + stamp updates), or
   * exactly one synthesized idle frame on an empty buffer with a policy in
   * effect. See {@link InputAccessor.consume}.
   *
   * Returns a POOLED iterator (reused across calls — no generator frame, no
   * per-call allocation) that walks the cursor `[_head, _iterEnd)` plus one
   * optional trailing idle frame. The cursor advances per `next()`, so `break`
   * (which calls `return()`) leaves the rest buffered and compacts. A nested
   * `consume()` of the SAME buffer while one is live falls back to a fresh
   * generator so the pooled `_iterRes` isn't clobbered (nesting is meaningless —
   * both share the cursor — but it must not corrupt).
   */
  consume(opts?: ConsumeOptions<I>): IterableIterator<I> {
    const empty = this.size === 0;
    const idle = empty ? this.idleFrameOnEmpty(opts) : undefined;
    if (empty && idle === undefined) { this._lastWasIdle = false; return DONE_ITERATOR as IterableIterator<I>; }
    // A nested consume() of this same buffer would clobber the pooled iterator's
    // shared state → hand the rare case a fresh generator instead.
    if (this._iterActive) { return this.consumeGen(idle); }
    this._iterActive = true;
    this._iterIdle = idle;                 // one trailing idle frame, or undefined
    this._iterEnd = this._items.length;    // snapshot — a (hypothetical) mid-loop push isn't consumed this pass
    return this.ensureIter();
  }

  [Symbol.iterator](): IterableIterator<I> {
    return this.consume();
  }

  /** Lazily mint the reused iterator. Closures over `this` so it reads the
   *  private cursor directly; one `_iterRes` is reused — read each result before
   *  the next `next()`, as `for..of` / spread / `Array.from` all do. */
  private ensureIter(): IterableIterator<I> {
    if (this._iter !== undefined) { return this._iter; }
    const self = this;
    const res = this._iterRes;
    const finish = (): IteratorResult<I> => {
      self.compact();
      self._iterActive = false;
      self._iterIdle = undefined;
      res.value = undefined;
      res.done = true;
      return res as IteratorResult<I>;
    };
    this._iter = {
      [Symbol.iterator]() { return this; },
      next(): IteratorResult<I> {
        if (self._head < self._iterEnd) {                // a buffered input
          res.value = self.stepHead();
          res.done = false;
          return res as IteratorResult<I>;
        }
        if (self._iterIdle !== undefined) {              // one trailing idle frame
          self._lastWasIdle = true;
          res.value = self._iterIdle;
          self._iterIdle = undefined;
          res.done = false;
          return res as IteratorResult<I>;
        }
        return finish();
      },
      return(): IteratorResult<I> { return finish(); },  // `break` → compact + release
    };
    return this._iter;
  }

  /** Re-entrant fallback: a fresh generator for a nested `consume()` of this same
   *  buffer (the pooled iterator is single-active). Same accounting + compaction. */
  private *consumeGen(idleFrame: I | undefined): IterableIterator<I> {
    const end = this._items.length;
    try {
      while (this._head < end) { yield this.stepHead(); }
      if (idleFrame !== undefined) { this._lastWasIdle = true; yield idleFrame; }
    } finally {
      this.compact();
    }
  }

  peek(): I[] {
    return this._items.slice(this._head);
  }

  at(value: number): I | undefined {
    if (this._seqField === undefined) { return undefined; }
    for (let i = this._head; i < this._items.length; i++) {
      if ((this._items[i] as any)[this._seqField] === value) { return this._items[i]; }
    }
    return undefined;
  }

  get size(): number {
    return this._items.length - this._head;
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
   *  `mode:"reckon"` rewind groups — rarely read directly. `0` until stamped. */
  get reckonTime(): number {
    return this._lastReckonTime;
  }

  /** Seq VALUE of the last consumed input — the reconciliation ack sent to the
   *  client. Reliable (no wire seq tracked): falls back to {@link consumedCount}
   *  for free. Unreliable: the framework wire seq, so a fully-dropped input doesn't
   *  make the ack lag the client's sent seq by the lost count. `0` before the first
   *  consume. */
  get ackSeq(): number {
    return this._seqs !== undefined ? this._lastConsumedSeq : this.consumedCount;
  }

  /** Whether the most recently produced frame was a synthesized idle (see {@link wasIdle}). */
  get wasIdle(): boolean {
    return this._lastWasIdle;
  }

  clear(): void {
    // Cleared inputs count as consumed: advance both the count and the seq-value ack
    // past them so the client's pending set drains (capture the newest seq before truncate).
    if (this._seqs !== undefined && this._items.length > 0) { this._lastConsumedSeq = this._seqs[this._items.length - 1]; }
    this.consumedCount += this.size;
    this.truncate();
    this._lastSeq = -Infinity;
    this._iterActive = false; // recovery hatch if a consume() iterator was abandoned unclosed
    this._iterIdle = undefined;
  }
}

/**
 * Default per-client accessor. Reads `_input` and `_inputBuffer` off the
 * client at access time — both are nullable until the room declares input
 * via `defineInput()`. Cached as `client._inputAccessor` at join, so
 * `room.inputs.get(sessionId)` is a Map lookup + property read.
 *
 * @internal
 */
export class InputAccessorImpl<I = any> implements InputAccessor<I> {
  private _client: ClientPrivate;
  constructor(client: ClientPrivate) { this._client = client; }
  get latest(): I | undefined { return this._client._input as I | undefined; }
  at(value: number): I | undefined { return this._client._inputBuffer?.at(value) as I | undefined; }
  consume(opts?: ConsumeOptions<I>): IterableIterator<I> {
    return (this._client._inputBuffer?.consume(opts) ?? EMPTY_INPUT_ITERATOR) as IterableIterator<I>;
  }
  [Symbol.iterator](): IterableIterator<I> { return this.consume(); }
  drain(opts?: ConsumeOptions<I>): I[] { return (this._client._inputBuffer?.drain(opts) ?? []) as I[]; }
  next(): I | undefined;
  next(opts: { idle: IdleInput<I> }): I;
  next(opts?: ConsumeOptions<I>): I | undefined { return this._client._inputBuffer?.next(opts) as I | undefined; }
  take(n: number): I[] { return (this._client._inputBuffer?.take(n) ?? []) as I[]; }
  peek(): I[] { return (this._client._inputBuffer?.peek() ?? []) as I[]; }
  get size(): number { return this._client._inputBuffer?.size ?? 0; }
  get consumedCount(): number { return this._client._inputBuffer?.consumedCount ?? 0; }
  get wasIdle(): boolean { return this._client._inputBuffer?.wasIdle ?? false; }
  clear(): void { this._client._inputBuffer?.clear(); }
  get renderTime(): number { return this._client._inputBuffer?.renderTime ?? 0; }
  get reckonTime(): number { return this._client._inputBuffer?.reckonTime ?? 0; }
}

/** Shared empty iterator for accessors without a buffer (bufferMaxSize: 0). */
const EMPTY_INPUT_ITERATOR: IterableIterator<any> = DONE_ITERATOR;

/**
 * Returned by `room.inputs.get(sessionId)` for unknown sessions and for rooms
 * that didn't call `defineInput()`.
 *
 * @internal
 */
export const NO_OP_INPUT_ACCESSOR: InputAccessor<any> = Object.freeze({
  latest: undefined,
  at: () => undefined,
  consume: () => EMPTY_INPUT_ITERATOR,
  [Symbol.iterator]: () => EMPTY_INPUT_ITERATOR,
  drain: () => [],
  next: () => undefined,
  take: () => [],
  peek: () => [],
  size: 0,
  consumedCount: 0,
  wasIdle: false,
  clear: () => {},
  renderTime: 0,
  reckonTime: 0,
});

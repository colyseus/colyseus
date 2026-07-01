/**
 * Types for the room input subsystem: the option shapes accepted by
 * `Room.defineInput()`, the per-client {@link InputAccessor} / room-wide
 * {@link InputAPI} surfaces, and the internal normalized options. Runtime
 * lives in `InputBuffer.ts`.
 */

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

/** Options for `Room.defineInput()`. The user-facing twin of the internal
 *  normalized {@link NormalizedInputOptions}. */
export interface DefineInputOptions<I = any> {
  seqField?: NumericFieldsOf<I>;
  bufferMaxSize?: number;
  /**
   * Input sanitization — never trust the wire. Applied IN PLACE to every
   * decoded frame before anything reads it (`latest`, the buffer, the `idle`
   * ctx). Map form = per-field `[min, max]` clamps with NaN-safe semantics
   * (NaN → min — closes the `Math.min(NaN, …)` poisoning hole); callback form
   * = arbitrary in-place fix-up. Sanitizers MODIFY, never reject. See
   * {@link SanitizeInput}.
   *
   * ```ts
   * sanitize: { moveF: [-1, 1], pitch: [-PITCH_LIMIT, PITCH_LIMIT], dt: [0, MAX_DT] },
   * // or:  sanitize: (f) => { f.angle = wrapAngle(f.angle); },
   * ```
   */
  sanitize?: SanitizeInput<I>;
  /**
   * Room-level absence policy: when a tick has no buffered input, bare
   * `drain()` / `next()` synthesize ONE "idle" frame from it — the schema's
   * defaults overlaid with the policy's overrides — so the sim loop needs no
   * empty-branch. Prefer the callback form, invoked lazily (only on
   * actually-empty ticks) with an {@link IdleContext} (`latest` + `sessionId`):
   *
   * ```ts
   * idle: ({ latest, sessionId }) => {
   *   const p = this.state.players.get(sessionId);   // closes over the room
   *   return p ? { yaw: p.yaw, plant: !!latest?.plant } : true;
   * }
   * ```
   *
   * Not declaring it keeps the skip behavior (`drain()` → `[]`). Per-call
   * `{ idle }` overrides this default; `{ idle: false }` suppresses it.
   * Synthesized frames never advance the reconcile ack or `renderTime`.
   */
  idle?: IdleInput<I>;
  /**
   * Fixed step rate in **Hz** cascaded to the client via the join handshake;
   * it predicts at dt = 1/tickRate for deterministic rollback. Defaults to
   * the `setTimestep` rate — pass this only when the prediction
   * step differs from it. NOTE: a *rate*, not an interval — `1000/30` is the
   * step in ms, a classic mistake; use {@link stepMs} for that. Superseded by
   * {@link stepMs} / {@link stepSeconds} when those are given.
   */
  tickRate?: number;
  /**
   * Fixed step as a duration in **milliseconds** — the unit-safe alternative
   * to {@link tickRate} (`stepMs: 1000/30` is unambiguous where
   * `tickRate: 1000/30` is a bug). Normalized to the canonical Hz value
   * (`1000/stepMs`). Takes precedence over `tickRate`.
   */
  stepMs?: number;
  /**
   * Fixed step as a duration in **seconds** (e.g. `1/30`). Normalized to the
   * canonical Hz value (`1/stepSeconds`). Highest precedence.
   */
  stepSeconds?: number;
  /**
   * Physics sub-steps per input tick (integer ≥ 1, default 1) — decouples the
   * PHYSICS rate from the input/network rate. One input still drives exactly
   * one fixed step (the replay invariant), but the simulation integrates
   * `subSteps` engine steps of `stepSeconds/subSteps` inside it, identically
   * on client and server — physics at `tickRate * subSteps` Hz while sending
   * `tickRate` inputs/sec. Cascaded to clients via the join handshake;
   * both sides read the derived numbers off their step context
   * (`ctx.subSteps` / `ctx.subDt`) so N and dt can't drift apart.
   * Usually declared via {@link Room.setFixedTimestep}'s `subSteps` option
   * instead — pass it here only when the room runs its own loop.
   */
  subSteps?: number;
}

/** `true` when the defineInput opts declared an `idle` policy — narrows the
 *  returned {@link InputAPI} so bare `next()` types non-optional `I`.
 *  @internal — exported for {@link RoomInput.define}. */
export type IdleDeclared<O, I> = O extends { idle: IdleInput<I> } ? true : false;

/**
 * Internal: input configuration captured by `Room.defineInput()` — the
 * normalized form of {@link DefineInputOptions} (step declarations resolved to
 * Hz, sanitizer compiled). The schema constructor is stored here so the
 * runtime doesn't need to know it through the public `room.inputs` (the
 * `.get(sessionId)` accessor).
 *
 * @internal
 */
export interface NormalizedInputOptions {
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
   *   lockstep / rollback netcode.
   * - **Timestamp** (`"timestamp"`, milliseconds or seconds) — useful for
   *   variable-rate clients, lag compensation, hit registration (a float-seconds
   *   timestamp stamped on each saved move is the common shape).
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
   * COMPILED sanitizer (see {@link SanitizeInput} / `compileSanitizer`) —
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

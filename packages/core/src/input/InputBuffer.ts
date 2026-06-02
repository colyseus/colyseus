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
 */
export interface InputAccessor<I = any> {
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

  /** Take everything buffered (oldest → newest) and clear. Snapshots are safe to retain. */
  drain(): I[];

  /**
   * Consume the single oldest buffered input and advance the reconcile ack by
   * exactly one — the complement to {@link peek}. Returns `undefined` (hold last)
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
   * @example
   * ```ts
   * this.setFixedTimestep(() => {
   *   for (const [sid, body] of bodies) {
   *     const cmd = this.input(sid).next();   // one input → ack +1
   *     if (cmd) applyInputToBody(body, cmd); // else hold last
   *   }
   *   world.step();                            // one step for everyone
   * }, 30);
   * ```
   */
  next(): I | undefined;

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
   * `bufferMaxSize > 0`. Rewind other entities to this time for lag-compensated
   * "what you see is what you hit" hit registration.
   */
  readonly renderTime: number;
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
export type InputAPI<I = any> = ((sessionId: string) => InputAccessor<I>) & {
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

  constructor(maxSize: number, seqField: string | undefined) {
    this._maxSize = maxSize;
    this._seqField = seqField;
  }

  push(snapshot: I, renderTime: number = 0): void {
    this._items.push(snapshot);
    this._renderTimes.push(renderTime);
    // Overflow drops oldest unconsumed input; count it consumed so the reconcile ack still advances past it.
    if (this._items.length > this._maxSize) {
      this._items.shift();
      this._renderTimes.shift(); // keep parallel with `_items`
      this.consumedCount++;
    }
  }

  /** Returns true if `value` hasn't been seen, and updates the last-seen marker. */
  accept(value: number): boolean {
    if (value <= this._lastSeq) { return false; }
    this._lastSeq = value;
    return true;
  }

  drain(): I[] {
    const out = this._items;
    // Report newest drained input's render time; persists across a subsequent empty drain.
    if (this._renderTimes.length > 0) {
      this._lastRenderTime = this._renderTimes[this._renderTimes.length - 1];
    }
    this.consumedCount += out.length;
    this._items = [];
    this._renderTimes = [];
    return out;
  }

  /** Consume the single oldest input (ack advances by one); `undefined` if empty. */
  next(): I | undefined {
    if (this._items.length === 0) { return undefined; }
    this._lastRenderTime = this._renderTimes.shift()!; // render time of THIS input
    this.consumedCount++;
    return this._items.shift();
  }

  /** Consume up to `n` oldest inputs (ack advances by the count actually taken). */
  take(n: number): I[] {
    if (n <= 0 || this._items.length === 0) { return []; }
    const count = Math.min(n, this._items.length);
    const out = this._items.splice(0, count);
    const times = this._renderTimes.splice(0, count);
    this._lastRenderTime = times[times.length - 1]; // newest taken input's render time
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

  clear(): void {
    this.consumedCount += this._items.length;
    this._items.length = 0;
    this._renderTimes.length = 0;
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
  drain(): I[] { return (this._client._inputBuffer?.drain() ?? []) as I[]; }
  next(): I | undefined { return this._client._inputBuffer?.next() as I | undefined; }
  take(n: number): I[] { return (this._client._inputBuffer?.take(n) ?? []) as I[]; }
  peek(): I[] { return (this._client._inputBuffer?.peek() ?? []) as I[]; }
  get size(): number { return this._client._inputBuffer?.size ?? 0; }
  clear(): void { this._client._inputBuffer?.clear(); }
  get renderTime(): number { return this._client._inputBuffer?.renderTime ?? 0; }
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
});

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
   * from `setSimulationInterval`. Unset = not advertised.
   */
  tickRate?: number;
}

/**
 * Per-client input accessor returned by `room.input(sessionId)`. Combines the
 * latest decoded instance with the (optional) snapshot ring buffer.
 *
 * - {@link latest} — the bound Schema instance, mutated in place by the
 *   decoder. Cheapest read; use when only the most recent state matters.
 * - {@link drain} / {@link peek} / {@link at} — populated when
 *   `defineInput()` was called with `bufferMaxSize > 0` (default 32).
 *   Use for rollback netcode / lockstep where every frame matters.
 *
 * Returned for unknown sessionIds and rooms without `defineInput()` is a
 * frozen no-op accessor (latest=undefined, drain/peek=[], at=undefined,
 * size=0, clear=no-op).
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

  /** Read everything buffered without consuming. */
  peek(): I[];

  /** Number of snapshots currently buffered. */
  readonly size: number;

  /** Drop all buffered snapshots (also resets the dedupe tracker). */
  clear(): void;

  /**
   * Server-clock render timestamp (ms since room start) of the most recently
   * drained input — the time the client was rendering the world at when it
   * issued that input. `0` until the first render-time-stamped input is drained.
   * Populated only when the Room called `defineInput(..., { renderTime: true })`
   * with `bufferMaxSize > 0`. Rewind other entities to this time for
   * lag-compensated "what you see is what you hit" hit registration.
   */
  readonly renderTime: number;
}

/**
 * Callable returned by `Room.defineInput()`. Assign it to `this.input` and
 * call `room.input(sessionId)` per tick to read each client's latest input
 * and/or buffered snapshots.
 */
export type InputAPI<I = any> = (sessionId: string) => InputAccessor<I>;

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
  peek: () => [],
  size: 0,
  clear: () => {},
  renderTime: 0,
});

import type { ClientPrivate } from '../Transport.ts';
import { $METADATA } from '../utils/Utils.ts';

import type {
  ConsumeOptions, IdleContext, IdleInput, InputAccessor, SanitizeInput,
} from './types.ts';

/**
 * @internal Validate a `subSteps` count. Throws on a fractional/non-positive
 * value: both sides loop `subSteps` times at `dt/subSteps`, so anything but a
 * whole number is a determinism bug, not a tunable. Shared by `defineInput`
 * and `setFixedTimestep`.
 */
export function validateSubSteps(subSteps: number | undefined, source: string): number | undefined {
  if (subSteps === undefined) { return undefined; }
  if (!Number.isInteger(subSteps) || subSteps < 1) {
    throw new Error(`[${source}] subSteps must be an integer >= 1 (got ${subSteps}).`);
  }
  return subSteps;
}

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
   *  per-tick loop allocates no generator frame. `_iterRemaining` snapshots the
   *  COUNT to walk — a count, not an index: mid-pass mutations (`next()`/`take()`/
   *  `clear()`/compaction) shift indices but can only shorten a count-based pass,
   *  never point it past the tail. `_iterIdle` is an optional trailing synthesized
   *  frame; `_iterActive` guards against a nested consume() clobbering the shared
   *  `_iterRes`. */
  private _iter?: IterableIterator<I>;
  private _iterRemaining = 0;
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
   * per-call allocation) that consumes at most the pending count snapshotted at
   * the call — never past the live tail — plus one optional trailing idle frame.
   * The cursor advances per `next()`, so `break` (which calls `return()`)
   * leaves the rest buffered and compacts. A nested
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
    this._iterRemaining = this.size;       // count snapshot — a (hypothetical) mid-loop push isn't consumed this pass
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
      self._iterRemaining = 0;
      self._iterIdle = undefined;
      res.value = undefined;
      res.done = true;
      return res as IteratorResult<I>;
    };
    this._iter = {
      [Symbol.iterator]() { return this; },
      next(): IteratorResult<I> {
        // `size > 0` re-checks the live tail: a mid-loop next()/take()/clear()
        // can only shorten the pass, never make it read past the end.
        if (self._iterRemaining > 0 && self.size > 0) {  // a buffered input
          self._iterRemaining--;
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
    let remaining = this.size;   // count-based walk, same reason as the pooled pass
    try {
      while (remaining-- > 0 && this.size > 0) { yield this.stepHead(); }
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
   *  {@link renderTime}. RAW: stays `0` until stamped — the resolved,
   *  always-usable value is the accessor's `reckonTime`
   *  (`room.inputs.get(sid)`); `rewind.lastSeenBy()`'s midpoint-reconstruction
   *  fallback depends on this raw `0`. */
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
    this._iterRemaining = 0;  // an abandoned iterator must not consume post-clear pushes
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
  /** Current room time (`clock.elapsedTime`) — resolves the {@link reckonTime}
   *  fallback. Threaded by `RoomInput.allocate()`; optional so bare
   *  constructions (tests) keep the raw 0. */
  private _nowOf?: () => number;
  constructor(client: ClientPrivate, nowOf?: () => number) {
    this._client = client;
    this._nowOf = nowOf;
  }
  get latest(): I | undefined { return this._client._input as I | undefined; }
  at(value: number): I | undefined { return this._client._inputBuffer?.at(value) as I | undefined; }
  consume(opts?: ConsumeOptions<I>): IterableIterator<I> {
    return (this._client._inputBuffer?.consume(opts) ?? DONE_ITERATOR) as IterableIterator<I>;
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
  /** @internal RAW reckon stamp (0 until stamped). The rewind binding reads
   *  THIS, not the resolved getter below: `Rewind._aim`'s midpoint fallback
   *  must still see 0 for unstamped clients (a resolved value would silently
   *  take the direct-stamp clamp path). */
  get rawReckonTime(): number { return this._client._inputBuffer?.reckonTime ?? 0; }
  get reckonTime(): number {
    const raw = this._client._inputBuffer?.reckonTime ?? 0;
    return raw > 0 ? raw : this._nowOf !== undefined ? this._nowOf() : 0;
  }
}

/**
 * Returned by `room.inputs.get(sessionId)` for unknown sessions and for rooms
 * that didn't call `defineInput()`.
 *
 * @internal
 */
export const NO_OP_INPUT_ACCESSOR: InputAccessor<any> = Object.freeze({
  latest: undefined,
  at: () => undefined,
  consume: () => DONE_ITERATOR,
  [Symbol.iterator]: () => DONE_ITERATOR,
  drain: () => [],
  next: () => undefined,
  take: () => [],
  peek: () => [],
  size: 0,
  consumedCount: 0,
  wasIdle: false,
  clear: () => {},
  renderTime: 0,
  reckonTime: 0, // stays 0 — an unknown session / input-less room has no clock to resolve against
});

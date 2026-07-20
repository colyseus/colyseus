import { encode } from '@colyseus/schema';
import { InputEncoder, type InputEncoderOptions, type InputMode } from '@colyseus/schema/input';
import { Protocol, ProtocolModifier } from '@colyseus/shared-types';

import type { Connection } from '../Connection.ts';
import { now } from '../core/utils.ts';

/**
 * Minimal structural type the input handle needs from its host (Room). Lets
 * us decouple from the full `Room` class so this module stays import-cycle
 * free, while still picking up the latest `connection` after a reconnect.
 *
 * @internal
 */
export interface InputHandleHost {
  connection?: Connection;
  /** Room clock — read for the server-clock render timestamp auto-stamped onto
   *  reliable inputs when render-time lag compensation is enabled. Structural
   *  to stay import-cycle free (the Room's RoomClockLike satisfies it).
   *  `lastServerTime`/`smoothedRtt` are optional so a bare `{ serverNow }` clock
   *  still satisfies it (it just stamps 0 / omits the latency term). */
  clock?: { serverNow(): number; lastServerTime?(): number; smoothedRtt?(): number };
}

/**
 * Options accepted by `Room.input()`. Extends {@link InputEncoderOptions}
 * (mode / historySize) with a `type` field for the schema constructor.
 * Inputs are ALWAYS delta-encoded (the codec has no full-snapshot mode):
 * each send carries only changed fields, or a body-less frame on a no-change
 * tick. Every `send()` transmits one input; to skip a tick, just don't call
 * `send()`.
 *
 * Recommended for rollback netcode: `{ mode: "unreliable", historySize: 4 }`
 * — small redundant deltas, idempotent across drops via absolute-value wire ops.
 *
 * `I` is intentionally unconstrained: pinning it to `Schema` from this
 * SDK's copy of `@colyseus/schema` would reject user-side schemas coming
 * from a different copy of the package (npm hoisting, multi-version
 * installs). Runtime calls duck-type via the encoder, so a structural
 * match is enough.
 */
export interface InputOptions<I = any> extends InputEncoderOptions {
  /**
   * Schema constructor for the input. Optional when the server room called
   * `defineInput()` — the schema then arrives via the JOIN handshake's input
   * reflection and is used automatically (the synthesized class mirrors the
   * server's fields, but `instanceof YourInput` won't pass on it). An explicit
   * ctor always wins over reflection — pass one to use your own class.
   * `room.input()` throws when neither source yields a constructor.
   */
  type?: new () => I;

  /**
   * Your interpolation buffer in ms — how far in the PAST you render remote
   * entities (e.g. a `Predict` lerp `delay`). It feeds the stamped
   * `renderDelta = renderDelay + smoothedRtt()/2`, from which the server
   * derives `renderTime = reckonTime − renderDelta`: this term covers the
   * interp buffer, and the SDK adds the one-way downstream latency itself. So
   * pass ONLY your interp buffer, never the latency.
   *
   * **Usually omit this.** When you wire the handle through
   * `predict.reconciler(self, { input })` or `predict.sim({ input })`, the SDK
   * binds this to the Predict's lerp `delay` automatically, so the interp buffer
   * the remotes render at and the server's rewind instant are derived from ONE
   * number and can't drift out of sync. Set it explicitly only to override that
   * (e.g. you smooth remotes some other way) — an explicit value always wins.
   *
   * Default `0` — correct when you dead-reckon remote entities to current server
   * time (no interp lag). Has no effect unless the Room rewinds a
   * `mode:"snapshot"` group (which auto-enables the renderTime stamp).
   */
  renderDelay?: number;

  /**
   * Predicate selecting which of this client's inputs the server may REWIND to —
   * i.e. which inputs carry their lag-comp timestamp on the wire. The client-side
   * mirror of the server room's `allowRewindState`: there the room records history
   * to rewind into; here you say which inputs are worth rewinding to. Omitted (the
   * default) stamps EVERY reliable input.
   *
   * Return `true` only for inputs the server lag-compensates — e.g. a firing input
   * that triggers a rewound hit-test — to drop the ~1-byte timestamp on the rest
   * (typically the majority of frames: moving/aiming without shooting). Evaluated
   * against the staged {@link InputHandle.data} on each {@link InputHandle.send}.
   *
   * A pure client-side bandwidth trim: the server already tolerates mixed
   * stamped/unstamped reliable inputs (an unstamped one reads `renderTime` 0 and
   * falls back to live), and the delta-coded stamp baseline self-syncs across the
   * gaps — no server change. Per-input ONLY: it gates the timestamp, not rewind
   * itself (that's the room's `allowRewindState`), so `() => false` just keeps the
   * server live for this client — it never disables rewind.
   *
   * ⚠ ONLY safe when the timestamp is consumed SERVER-side (a `mode:"snapshot"`
   * renderTime rewind for hit registration). If the CLIENT reads the stamp for its
   * OWN prediction — a `mode:"reckon"` room whose reconciler hit-tests at
   * `ctx.reckonTime` every step — every input needs it; do NOT set this there.
   */
  allowRewind?: (data: I) => boolean;
}

/**
 * Per-room input handle returned by `Room.input()`. Mutate {@link data}
 * to stage the next input, then call {@link send} to encode and transmit on
 * the channel chosen at construction (reliable or unreliable).
 *
 * @example
 * ```typescript
 * const input = room.input({ type: MoveInput, mode: "unreliable" });
 * input.data.vx = 10;
 * input.data.vy = 20;
 * input.send();
 * ```
 */
export interface InputHandle<I = any> {
  /** Mutable schema instance — mutate, then call {@link send}. */
  readonly data: I;
  /** Wire mode this handle was constructed with. */
  readonly mode: InputMode;
  /**
   * Server-advertised fixed simulation/input step rate in Hz, from
   * `defineInput({ tickRate })` cascaded through the join handshake. Predict at
   * this exact rate (dt = 1/tickRate) so client rollback-replay stays
   * deterministic with the server — the single source of truth for the
   * timestep. `undefined` when the server didn't advertise one (fall back to
   * your own constant).
   */
  readonly tickRate?: number;
  /**
   * The fixed step as **seconds** (`1/tickRate`) — the exact dt to predict and
   * rollback-replay each input with, matching the server's per-input dt. Prefer
   * this over hand-computing `1/tickRate`. `undefined` when no rate advertised.
   */
  readonly stepSeconds?: number;
  /**
   * The fixed step as **milliseconds** (`1000/tickRate`), e.g. to drive a
   * fixed-timestep accumulator. `undefined` when no rate advertised.
   */
  readonly stepMs?: number;
  /**
   * Server-advertised state-patch interval (ms) from the join handshake = the
   * reconcile/correction cadence (acks + authoritative state arrive this often).
   * A reconciler can tune its correction-smoothing window to it. `undefined`
   * when not advertised.
   */
  readonly patchRate?: number;
  /**
   * Server-advertised physics sub-steps per input tick, from
   * `setFixedTimestep(..., { subSteps })` cascaded through the join handshake.
   * One input still drives ONE predicted/replayed step, but inside it the
   * simulation integrates this many engine steps of {@link subStepSeconds} —
   * physics at `tickRate * subSteps` Hz on a `tickRate` input rate. `1` when
   * the server didn't sub-step. The reconcilers default their step context's
   * `subSteps`/`subDt` from this.
   */
  readonly subSteps: number;
  /**
   * The physics sub-step as **seconds** (`stepSeconds / subSteps`) — the exact
   * engine dt for each sub-step, bit-identical to the server's `ctx.subDt`.
   * Equals {@link stepSeconds} when `subSteps` is 1; `undefined` when no rate
   * advertised.
   */
  readonly subStepSeconds?: number;
  /** The physics sub-step as **milliseconds** (`stepMs / subSteps`). `undefined`
   *  when no rate advertised. */
  readonly subStepMs?: number;
  /**
   * Encode the staged input and send it. Routes to the reliable or
   * unreliable channel based on {@link mode}.
   *
   * A no-op ONLY when the connection isn't open. Otherwise it always
   * transmits one input — a **body-less** frame when nothing changed since the
   * last send (the server decodes it as a no-op, holding the last values), so
   * the server receives exactly one input per `send()` and its consumed/ack
   * count tracks yours 1:1. To skip a tick entirely, simply don't call `send()`.
   *
   * Returns the seq assigned to this input — the same value the reconciler steps,
   * that {@link at}/{@link reckonTimeAt} key on, and that {@link sentCount} now
   * reads. It is `0` when nothing was sent (connection closed); seqs are 1-based,
   * so `const seq = input.send(); if (seq) …` doubles as a "did it transmit?" check.
   */
  send(): number;
  /**
   * Subscribe to sends: `listener(seq)` fires synchronously at the END of each
   * {@link send} (after the input is buffered for replay and its reckon instant
   * stamped), with the just-sent seq. Returns an unsubscribe fn.
   *
   * This is how the prediction layer OBSERVES your input stream without owning the
   * send: `predict.reconciler(...)` / `predict.sim(...)` subscribe here and step
   * their predicted simulation for the sent input — so you mutate + send through
   * the handle (`input.data.x = …; input.send()`) and prediction stays current
   * with zero extra calls on your side. `at(seq)` / `reckonTimeAt(seq)` are valid
   * inside the listener. Empty (no allocation, no dispatch) when nothing subscribes.
   */
  onSend(listener: (seq: number) => void): () => void;
  /**
   * Reset encoder state. Drops the unreliable ring buffer; re-marks every
   * populated field as dirty so the next send emits a full snapshot. Useful
   * on scene transitions; the SDK calls it itself on the reconnect path.
   * Observing rollback controllers follow a reset automatically (they poll
   * {@link epoch}) — no manual `Reconciler.reset()` wiring needed.
   */
  reset(): void;
  /**
   * Monotonic reset counter: increments on every {@link reset}, whatever
   * triggered it (the SDK's reconnect path or an app call). Rollback
   * controllers poll it each tick and self-reset when it moves. Compare with
   * `!==`, never `+1` — multiple resets can land between polls.
   */
  readonly epoch: number;
  /**
   * Last input the server has acknowledged PROCESSING into its authoritative
   * state (the server input-buffer's consumed count, echoed via the TIMED
   * prefix). The canonical server-reconciled-rollback ack — prune your pending
   * inputs against it (`seq <= lastProcessed`). `0` until the first ack.
   *
   * Lives here (not on `room.clock`) because it's an INPUT concern: this is the
   * channel you send through, so it's the channel that knows what's been acked.
   */
  readonly lastProcessed: number;
  /**
   * Count of reliable inputs this handle has actually transmitted — equals the
   * seq the server will ack via {@link lastProcessed}. Key a client-side
   * prediction/replay buffer by this (read it right AFTER {@link send}).
   */
  readonly sentCount: number;
  /**
   * Reliable inputs sent but not yet acked (`sentCount − lastProcessed`) — the
   * in-flight set a reconciler replays on rollback.
   */
  readonly pendingCount: number;
  /**
   * Capacity (in seqs) of the replay ring backing {@link at} — the in-flight
   * window this handle can serve. A reconciler sizes its own per-seq state to
   * this, so both rings cover the same window and age out together.
   */
  readonly replayBufferSize: number;
  /**
   * The buffered snapshot of the reliable input sent as `seq`, for
   * reconciliation replay — the client-side mirror of the server's input
   * buffer. Returns `undefined` if `seq` is already acked, was never sent, or
   * has aged out of the bounded ring. The returned instance is REUSED — read it
   * synchronously during replay, don't retain it.
   */
  at(seq: number): I | undefined;
  /**
   * The reckon instant (server-clock ms) stamped onto reliable input `seq` — the
   * client's `serverNow()` estimate at send, the SAME value the server reads as
   * `channel.reckonTime` (and `rewind.lastSeenBy(sid)`). The reconciler surfaces
   * it as `ctx.reckonTime` so a prediction step hit-tests remote entities at the
   * exact instant the server rewinds to (live AND replay). `0` when reckon
   * lag-comp isn't enabled (the room never rewinds to it — fall back to
   * `serverNow()`), or if `seq` is unsent, acked, aged out, or pre-clock-sync.
   */
  reckonTimeAt(seq: number): number;
}

/** @internal */
export class InputHandleImpl<I = any> implements InputHandle<I> {
  public readonly data: I;
  private _host: InputHandleHost;
  private _encoder: InputEncoder<any>;
  // Reused frame buffer — safe ONLY because every transport copies synchronously
  // on send (browser ws.send snapshots; H3 frame() copies before write). A
  // transport that queued the view uncopied would see it overwritten next send.
  private _scratch: Uint8Array = new Uint8Array(2048);
  // Cached framed-packet view into `_scratch`; re-made when the packet size
  // changes (delta bodies vary) or `_scratch` grows — so it mostly pays off on
  // steady no-change frames.
  private _framed: Uint8Array | null = null;

  // Input round-trip state (one handle per room).
  private _sentCount = 0;                       // reliable inputs transmitted
  private _lastProcessed = 0;                   // server-acked (consumedCount)
  private _epoch = 0;                           // reset counter — see InputHandle.epoch
  // RTT send-time ring (seq % size → send time); avoids per-send Map churn.
  // Sized WITH the replay ring (one seq window — replay and RTT age out together).
  private _sendTimes: Float64Array;

  // Sent-input replay ring, mirroring the server's per-client input buffer: each reliable send snapshots
  // `data` into slot `seq % size` via alloc-free `copyInto` so a reconciler can replay unacked inputs.
  // Size = worst-case in-flight = (RTT + patch interval) × input rate. tickRate/patchRate from the
  // handshake (ack rides the patch, so lags up to one interval); RTT is budgeted generously. Floored
  // at 64; grows for high input rates where 64 would silently overflow (aged-out entries warn once).
  private static readonly BUFFER_FLOOR = 64;
  private static readonly BUFFER_RTT_BUDGET_MS = 1000;
  private static readonly BUFFER_HEADROOM = 1.5;
  private readonly _inputBufferSize: number;
  private _inputBuffer: I[] | null = null;      // lazily allocated (needs data ctor)
  // Per-seq reckonTime stamp (server-clock ms), parallel to _inputBuffer — the
  // reconciler reads it back as ctx.reckonTime on the live step AND on replay, so
  // both hit-test at the exact instant the server rewinds to. Sized = replay ring.
  // Lazily allocated AND only when reckon stamping is on (`_stampReckon`): a room
  // without reckon lag-comp never rewinds to it, so we don't track it (ctx.reckonTime
  // then reads 0 and callers fall back to serverNow()).
  private _reckonTimes: Float64Array | null = null;
  // Reckon instant of the in-flight send() — computed in send() when stamping,
  // stamped on the wire AND recorded into _reckonTimes by _recordSent (same value
  // both). 0 when not stamping.
  private _pendingReckon = 0;
  // Running baseline for the DELTA-CODED reliable stamp: the last timeline u32
  // sent. Each stamped send transmits `stamp − _lastStamp` (signed, ≈ one fixed
  // step per tick → ~1 byte vs a raw 4-byte u32); the server mirrors this baseline
  // and reliable+in-order keeps the two locked. reset() re-zeros it so the first
  // delta after a (re)connect carries the absolute, re-syncing with the server's
  // freshly-allocated baseline.
  private _lastStamp = 0;
  private static _warnedBufferOverflow = false;

  // Lag-comp stamp (server INPUT_OPTIONS handshake): which timeline(s) each
  // reliable input is prefixed with, DELTA-CODED on the wire (see _lastStamp).
  // Both → [varint Δreckon][u16 renderDelta]; reckon-only → [varint Δreckon];
  // render-only → [varint Δrender]; neither → no prefix.
  private _stampRender = false;
  private _stampReckon = false;
  // Optional per-send gate (app `allowRewind`): when set, only inputs it returns
  // true for carry the stamp — the rest skip it (and the TIMED bit), trimming the
  // timestamp on frames the server won't rewind (e.g. non-firing inputs). The
  // delta baseline (`_lastStamp`) only advances on stamped sends, so it stays
  // locked with the server across the gaps. Absent ⇒ stamp every reliable input.
  private _allowRewind?: (data: I) => boolean;
  // Send observers (the prediction layer subscribes here to step its simulation
  // on each send — see onSend). null until the first subscribe, so a handle used
  // without prediction pays nothing (no allocation, no per-send dispatch).
  // COPY-ON-WRITE: subscribe/unsubscribe replace the array (cold path), so the
  // dispatch loop's captured ref can't skip or double-fire when a listener
  // mutates the list mid-dispatch.
  private _sendListeners: Array<(seq: number) => void> | null = null;
  // The app's interpolation buffer (ms) — how far in the past it renders remote
  // entities (e.g. a `Predict` lerp `delay`). The stamp subtracts this AND the
  // one-way latency (smoothedRtt/2) the SDK already tracks, so callers pass only
  // the interp buffer, never the latency. When the app doesn't set it explicitly,
  // `predict.reconciler`/`sim` bind `_renderDelayProvider` to the Predict lerp
  // `delay` (see bindRenderDelay) so the interp buffer and the server's rewind
  // instant stay ONE value — no two-number "keep these equal" footgun.
  private _renderDelay = 0;
  private _renderDelayExplicit = false;
  private _renderDelayProvider: (() => number) | undefined;
  // Server-advertised rates: fixed step (Hz), patch interval (ms = reconcile
  // cadence), and physics sub-steps per input tick.
  private _tickRate?: number;
  private _patchRate?: number;
  private _subSteps = 1;

  constructor(
    host: InputHandleHost,
    data: I,
    encoder: InputEncoder<any>,
    opts?: { stampRender?: boolean; stampReckon?: boolean; renderDelay?: number; tickRate?: number; patchRate?: number; subSteps?: number; allowRewind?: (data: I) => boolean },
  ) {
    this._host = host;
    this.data = data;
    this._encoder = encoder;
    this._stampRender = opts?.stampRender ?? false;
    this._stampReckon = opts?.stampReckon ?? false;
    this._allowRewind = opts?.allowRewind;
    this._renderDelay = opts?.renderDelay ?? 0;
    this._renderDelayExplicit = opts?.renderDelay !== undefined;
    this._tickRate = opts?.tickRate;
    this._patchRate = opts?.patchRate;
    this._subSteps = opts?.subSteps ?? 1;

    // Size the replay ring to the advertised rates (see field comment).
    const stepMs = this._tickRate ? 1000 / this._tickRate : (1000 / 60);
    const window = InputHandleImpl.BUFFER_RTT_BUDGET_MS + (this._patchRate ?? 0);
    this._inputBufferSize = Math.max(
      InputHandleImpl.BUFFER_FLOOR,
      Math.ceil((window / stepMs) * InputHandleImpl.BUFFER_HEADROOM),
    );
    this._sendTimes = new Float64Array(this._inputBufferSize);
  }

  get mode(): InputMode { return this._encoder.mode; }
  get tickRate(): number | undefined { return this._tickRate; }
  // `1/hz` is correctly-rounded IEEE-754 → bit-identical to the server's stepSeconds.
  get stepSeconds(): number | undefined { return this._tickRate ? 1 / this._tickRate : undefined; }
  get stepMs(): number | undefined { return this._tickRate ? 1000 / this._tickRate : undefined; }
  get patchRate(): number | undefined { return this._patchRate; }
  get subSteps(): number { return this._subSteps; }
  // `(1/hz)/n` — the SAME expression the server's ctx.subDt uses → bit-identical dt.
  get subStepSeconds(): number | undefined { return this._tickRate ? (1 / this._tickRate) / this._subSteps : undefined; }
  get subStepMs(): number | undefined { return this._tickRate ? (1000 / this._tickRate) / this._subSteps : undefined; }
  get lastProcessed(): number { return this._lastProcessed; }
  get sentCount(): number { return this._sentCount; }
  get pendingCount(): number { return this._sentCount - this._lastProcessed; }
  get replayBufferSize(): number { return this._inputBufferSize; }
  get epoch(): number { return this._epoch; }

  at(seq: number): I | undefined {
    if (this._inputBuffer === null) return undefined;
    // Buffered iff sent, not yet acked, and still within the bounded ring window.
    if (seq <= this._lastProcessed || seq > this._sentCount) return undefined;
    if (this._sentCount - seq >= this._inputBufferSize) {
      // Pending input aged out (RTT exceeded the buffer budget); reconcile may drift, so warn once.
      if (!InputHandleImpl._warnedBufferOverflow) {
        InputHandleImpl._warnedBufferOverflow = true;
        console.warn(
          `@colyseus/sdk: input replay buffer (${this._inputBufferSize}) overflowed — ` +
          `RTT exceeds its budget at this input rate; reconciliation may drift.`,
        );
      }
      return undefined;
    }
    return this._inputBuffer[seq % this._inputBufferSize];
  }

  reckonTimeAt(seq: number): number {
    // 0 when reckon stamping is off (no ring) — callers fall back to serverNow().
    if (this._reckonTimes === null) return 0;
    // Same validity window as at(): sent, unacked, still in the ring. Live reads
    // it for the just-sent seq (== sentCount); replay reads each unacked seq.
    if (seq <= this._lastProcessed || seq > this._sentCount) return 0;
    if (this._sentCount - seq >= this._inputBufferSize) return 0;
    return this._reckonTimes[seq % this._inputBufferSize];
  }

  reset(): void {
    this._encoder.reset();
    // Adopt the encoder's monotonic seq as the baseline: 0 for reliable, the current
    // framework seq for unreliable (the encoder keeps `_seq` across its reset). pending
    // starts at 0 so a reconnect doesn't replay already-acked inputs, and unreliable
    // seqs continue past the server's last-seen seq if the buffer was reused.
    this._sentCount = this._lastProcessed = this._encoder.seq;
    this._framed = null;
    this._lastStamp = 0; // next stamped send ships an absolute delta — re-syncs the server's re-zeroed baseline
    this._sendTimes.fill(0); // stale acks for pre-reset seqs must read as "unknown" (-1), not a bogus RTT
    // _inputBuffer is reused as-is: at() gates on _sentCount/_lastProcessed, so it can't surface stale snapshots.
    this._epoch++; // observing controllers poll this and follow the reset
  }

  /**
   * @internal Bind lag-comp's `renderDelay` to a live provider — the owning
   * Predict's lerp `delay`. Called by `predict.reconciler`/`predict.sim` when
   * they wire this handle, so the remote interp buffer and the server's rewind
   * instant are derived from ONE number and can't drift apart. No-op if the app
   * passed an explicit `renderDelay` to `room.input()` — an explicit value wins.
   */
  bindRenderDelay(provider: () => number): void {
    if (this._renderDelayExplicit) return;
    this._renderDelayProvider = provider;
  }

  /** Effective interp buffer (ms): a bound provider (the Predict lerp `delay`)
   *  when present, else the static value from `room.input()`. */
  private _resolveRenderDelay(): number {
    return this._renderDelayProvider ? this._renderDelayProvider() : this._renderDelay;
  }

  send(): number {
    const conn = this._host.connection;
    if (!conn?.isOpen) return 0;   // nothing transmitted → seq 0 (seqs are 1-based)

    // May be 0-length on a no-change delta tick → we still frame + send a
    // body-less input (server decodes it as a no-op, holding the last values).
    // Callers skip a tick by not calling send(), not by relying on suppression.
    const bytes = this._encoder.encode();
    const reliable = this._encoder.mode === "reliable";

    // Lag-comp stamp prefix (reliable only): OR the TIMED modifier onto the
    // opcode and prepend the delta-coded timeline stamp (wire shape + baseline
    // story: see _stampRender/_lastStamp). `allowRewind` (when present) skips the
    // stamp on inputs the server won't rewind — the baseline only advances on
    // stamped sends, so it stays locked across the gaps.
    const wantStamp = (this._stampReckon || this._stampRender) && reliable
      && (this._allowRewind === undefined || this._allowRewind(this.data));
    const both = this._stampReckon && this._stampRender;
    // Upper bound: opcode + stamp (number codec ≤9B for Δ, +2B u16 renderDelta) + body.
    const stampMax = wantStamp ? (both ? 9 + 2 : 9) : 0;
    const totalMax = 1 + stampMax + bytes.length;
    if (totalMax > this._scratch.byteLength) {
      this._scratch = new Uint8Array(Math.max(totalMax, this._scratch.byteLength * 2));
      this._framed = null;   // cached view points into the old buffer
    }
    this._scratch[0] = (reliable ? Protocol.ROOM_INPUT_RELIABLE : Protocol.ROOM_INPUT_UNRELIABLE)
      | (wantStamp ? ProtocolModifier.TIMED : 0);

    const it = { offset: 1 };
    if (wantStamp) {
      // The reckon instant for THIS send: the client's serverNow() estimate
      // (rounded u32 ms), 0 until the clock syncs. Wire-stamped below AND
      // recorded per-seq (read-back story: see _pendingReckon/_reckonTimes).
      const clock = this._host.clock;
      const synced = (clock?.lastServerTime?.() ?? 0) > 0;
      const rk = synced ? Math.max(0, Math.round(clock!.serverNow())) >>> 0 : 0;
      this._pendingReckon = rk;
      // reckonTime stamps the display ESTIMATE directly: the server reads its
      // history at this exact index, so clock/RTT estimation error cancels
      // (client displayed f(est), server reads f(est)).
      // renderTime = reckonTime − renderDelta — the SNAPSHOT timeline (what
      // lerped remotes were on screen): renderDelta = the interp buffer
      // (`renderDelay`, app-set) + the one-way downstream latency (≈ smoothedRtt/2,
      // ours). BOTH mode ships reckonTime + a u16 renderDelta (the gap is bounded
      // ≪ 65s) and the server derives renderTime; single-timeline modes ship the
      // one they use. All 0 until the clock syncs → the server falls back to
      // live positions instead of a bogus stamp.
      const renderDelta = synced
        ? Math.min(0xffff, Math.max(0, Math.round(this._resolveRenderDelay() + (clock!.smoothedRtt?.() ?? 0) / 2)))
        : 0;
      // Emit the mode's single u32 timeline, delta-coded against the baseline;
      // BOTH then trails the absolute u16 renderDelta.
      const stamp = this._stampReckon ? rk : (rk > renderDelta ? rk - renderDelta : 0);
      encode.number(this._scratch, stamp - this._lastStamp, it);
      this._lastStamp = stamp;
      if (both) { encode.uint16(this._scratch, renderDelta, it); }
    } else {
      this._pendingReckon = 0; // not stamping → no reckon instant to record
    }

    // [stamp?][body] — body continues from the stamp's end offset.
    this._scratch.set(bytes, it.offset);
    const total = it.offset + bytes.length;

    if (this._framed === null || this._framed.byteLength !== total) {
      this._framed = this._scratch.subarray(0, total);   // reused view (size varies only with the stamp prefix)
    }
    const framed = this._framed;
    let seq: number;
    if (reliable) {
      conn.send(framed);
      // Reliable: implicit count seq — the server counts received messages, so
      // `_sentCount` mirrors its consumed counter for the next TIMED ack.
      seq = ++this._sentCount;
    } else {
      conn.sendUnreliable(framed);
      // Unreliable: adopt the encoder's framework seq (stamped on the wire) so the
      // server's seq-value ack and this replay ring line up across packet loss.
      seq = this._sentCount = this._encoder.seq;
    }
    this._recordSent(seq);
    // Local, not _sentCount: a re-entrant send() from an onSend listener would
    // have advanced the field before this returns.
    return seq;
  }

  /**
   * @internal Snapshot the just-sent input into the replay ring and stamp its
   * send time, keyed by `seq`. Lets a reconciler replay unacked inputs via
   * {@link at} and the TIMED ack sample RTT. The snapshot is alloc-free through
   * the codec's `copyInto` (no `Object.keys`), which stages every field, so
   * each slot is a full snapshot independent of the wire delta encoding.
   */
  private _recordSent(seq: number): void {
    if (this._inputBuffer === null) {
      const Ctor = (this.data as any).constructor;
      this._inputBuffer = Array.from({ length: this._inputBufferSize }, () => new Ctor() as I);
    }
    this._encoder.copyInto(this._inputBuffer[seq % this._inputBufferSize]);
    this._sendTimes[seq % this._inputBufferSize] = now();
    // Reckon ring only when reckon stamping is on (see _reckonTimes) — a room
    // without reckon lag-comp never rewinds to it, so the allocation is skipped.
    if (this._stampReckon) {
      (this._reckonTimes ??= new Float64Array(this._inputBufferSize))[seq % this._inputBufferSize] = this._pendingReckon;
    }
    // Notify send observers LAST — the replay ring + reckon instant are now
    // recorded, so a listener can read `at(seq)` / `reckonTimeAt(seq)`.
    const ls = this._sendListeners;
    if (ls !== null) for (let i = 0; i < ls.length; i++) ls[i](seq);
  }

  onSend(listener: (seq: number) => void): () => void {
    const ls = this._sendListeners;
    this._sendListeners = ls !== null ? [...ls, listener] : [listener];
    return () => {
      const cur = this._sendListeners;
      if (cur === null) return;
      const i = cur.indexOf(listener);
      if (i < 0) return;
      const next = cur.slice();
      next.splice(i, 1);
      this._sendListeners = next.length > 0 ? next : null;
    };
  }

  /**
   * @internal Feed the server's last-PROCESSED input seq (decoded from the
   * TIMED prefix). Advances {@link lastProcessed} (monotonic) and returns the
   * round-trip time sample for that ack (`now − sendTime(seq)`), or `-1` if the
   * send time is unknown. The {@link RoomClock} filters/EMA-smooths the sample.
   */
  ackInput(seq: number): number {
    if (seq <= this._lastProcessed) return -1;
    // Aged out of the seq ring window → RTT unknown.
    const aged = this._sentCount - seq >= this._inputBufferSize;
    this._lastProcessed = seq;
    if (aged) return -1;
    const sentAt = this._sendTimes[seq % this._inputBufferSize];
    return sentAt > 0 ? now() - sentAt : -1;
  }
}

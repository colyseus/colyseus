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
 * (mode / historySize / delta / buffer) with a `type` field for the schema
 * constructor.
 *
 * Recommended for rollback netcode: `{ mode: "unreliable", delta: true,
 * historySize: 4 }` — small redundant deltas, idempotent across drops via
 * absolute-value wire ops.
 *
 * `I` is intentionally unconstrained: pinning it to `Schema` from this
 * SDK's copy of `@colyseus/schema` would reject user-side schemas coming
 * from a different copy of the package (npm hoisting, multi-version
 * installs). Runtime calls duck-type via the encoder, so a structural
 * match is enough.
 */
export interface InputOptions<I = any> extends InputEncoderOptions {
  /**
   * Schema constructor for the input. Required when server-sent reflection
   * isn't available (which is the default today). Once handshake-time input
   * reflection lands, `type` becomes optional.
   */
  type?: new () => I;

  /**
   * Your interpolation buffer in ms — how far in the PAST you render remote
   * entities (e.g. a `Predict` lerp `delay`). It feeds the stamped
   * `renderDelta = renderDelay + smoothedRtt()/2`, from which the server
   * derives `renderTime = reckonTime − renderDelta`: this term covers the
   * interp buffer, and the SDK adds the one-way downstream latency itself. So
   * pass ONLY your interp buffer, never the latency. Default `0` — correct
   * when you dead-reckon remote entities to current server time (no interp
   * lag). Has no effect unless the Room rewinds a `mode:"snapshot"` group (which
   * auto-enables the renderTime stamp).
   */
  renderDelay?: number;
}

/**
 * Per-room input handle returned by `Room.input()`. Mutate {@link data}
 * to stage the next input, then call {@link send} to encode and transmit on
 * the channel chosen at construction (reliable or unreliable).
 *
 * @example
 * ```typescript
 * const input = conn.input({ type: MoveInput, mode: "unreliable" });
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
   * No-op when the connection isn't open, or — in reliable + delta mode —
   * when nothing changed since the last send.
   */
  send(): void;
  /**
   * Reset encoder state. Drops the unreliable ring buffer; re-marks every
   * populated field as dirty in delta mode (next send emits a full
   * snapshot). Useful on scene transitions or after reconnection.
   */
  reset(): void;
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
   * The buffered snapshot of the reliable input sent as `seq`, for
   * reconciliation replay — the client-side mirror of the server's input
   * buffer. Returns `undefined` if `seq` is already acked, was never sent, or
   * has aged out of the bounded ring. The returned instance is REUSED — read it
   * synchronously during replay, don't retain it.
   */
  at(seq: number): I | undefined;
}

/** @internal */
export class InputHandleImpl<I = any> implements InputHandle<I> {
  public readonly data: I;
  private _host: InputHandleHost;
  private _encoder: InputEncoder<any>;
  private _scratch: Uint8Array = new Uint8Array(2048);
  // Cached framed-packet view into `_scratch`; avoids a per-send subarray. Re-made when packet size changes or `_scratch` grows.
  private _framed: Uint8Array | null = null;

  // Input round-trip state (one handle per room).
  private _sentCount = 0;                       // reliable inputs transmitted
  private _lastProcessed = 0;                   // server-acked (consumedCount)
  // RTT send-time ring (seq % size → send time); avoids per-send Map churn. Sized above realistic in-flight.
  private static readonly SEND_TIME_SIZE = 256;
  private _sendTimes = new Float64Array(InputHandleImpl.SEND_TIME_SIZE);

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
  private static _warnedBufferOverflow = false;

  // Lag-comp stamp (server INPUT_OPTIONS handshake): which timeline(s) each
  // reliable input is prefixed with. Both → [u32 reckonTime][u16 renderDelta]
  // (6B); reckon-only → [u32 reckonTime] (4B); render-only → [u32 renderTime]
  // (4B); neither → no prefix.
  private _stampRender = false;
  private _stampReckon = false;
  // The app's interpolation buffer (ms) — how far in the past it renders remote
  // entities (e.g. a `Predict` lerp `delay`). The stamp subtracts this AND the
  // one-way latency (smoothedRtt/2) the SDK already tracks, so callers pass only
  // the interp buffer, never the latency.
  private _renderDelay = 0;
  // Server-advertised rates: fixed step (Hz), patch interval (ms = reconcile
  // cadence), and physics sub-steps per input tick.
  private _tickRate?: number;
  private _patchRate?: number;
  private _subSteps = 1;

  constructor(
    host: InputHandleHost,
    data: I,
    encoder: InputEncoder<any>,
    opts?: { stampRender?: boolean; stampReckon?: boolean; renderDelay?: number; tickRate?: number; patchRate?: number; subSteps?: number },
  ) {
    this._host = host;
    this.data = data;
    this._encoder = encoder;
    this._stampRender = opts?.stampRender ?? false;
    this._stampReckon = opts?.stampReckon ?? false;
    this._renderDelay = opts?.renderDelay ?? 0;
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

  reset(): void {
    this._encoder.reset();
    // Adopt the encoder's monotonic seq as the baseline: 0 for reliable, the current
    // framework seq for unreliable (the encoder keeps `_seq` across its reset). pending
    // starts at 0 so a reconnect doesn't replay already-acked inputs, and unreliable
    // seqs continue past the server's last-seen seq if the buffer was reused.
    this._sentCount = this._lastProcessed = this._encoder.seq;
    this._framed = null;
    this._sendTimes.fill(0); // stale acks for pre-reset seqs must read as "unknown" (-1), not a bogus RTT
    // _inputBuffer is reused as-is: at() gates on _sentCount/_lastProcessed, so it can't surface stale snapshots.
  }

  send(): void {
    const conn = this._host.connection;
    if (!conn?.isOpen) return;

    const bytes = this._encoder.encode();
    if (bytes.length === 0) return; // delta no-op — nothing to send, nothing to count

    // Lag-comp stamp prefix (reliable only): OR the TIMED modifier onto the
    // opcode and prepend the timeline stamp(s) the server advertised. BOTH ships
    // [u32 reckonTime][u16 renderDelta] (6B); a single timeline ships its one
    // [u32] (4B). The server reads the length from its own derived mode.
    const wantStamp = (this._stampReckon || this._stampRender) && this._encoder.mode === "reliable";
    const both = this._stampReckon && this._stampRender;
    const prefixLen = wantStamp ? (both ? 6 : 4) : 0;
    const total = 1 + prefixLen + bytes.length;
    if (total > this._scratch.byteLength) {
      this._scratch = new Uint8Array(Math.max(total, this._scratch.byteLength * 2));
      this._framed = null;   // cached view points into the old buffer
    }
    if (wantStamp) {
      this._scratch[0] = Protocol.ROOM_INPUT_RELIABLE | ProtocolModifier.TIMED;
      // reckonTime — the RECKON-timeline instant: forward-reckoned entities
      // display at the client's serverNow ESTIMATE, so stamp that estimate
      // DIRECTLY. The server reads its history at this exact index, so clock /
      // RTT estimation error cancels out (client displayed f(est), server reads
      // f(est)).
      // renderTime = reckonTime − renderDelta — the SNAPSHOT timeline (what
      // lerped remotes were on screen); renderDelta trails by the interp buffer
      // (`renderDelay`, app-set) PLUS the one-way downstream latency
      // (≈ smoothedRtt/2, ours). BOTH mode ships reckonTime + a u16 renderDelta
      // (only the base needs u32 range; the gap is bounded ≪ 65s) and the server
      // derives renderTime; single-timeline modes ship the one absolute u32 they
      // use. All 0 until the clock syncs (lastServerTime still 0) → the server
      // falls back to live positions instead of a bogus stamp.
      const clock = this._host.clock;
      const synced = (clock?.lastServerTime?.() ?? 0) > 0;
      const rk = synced ? Math.max(0, Math.round(clock!.serverNow())) >>> 0 : 0;
      const delta = synced
        ? Math.min(0xffff, Math.max(0, Math.round(this._renderDelay + (clock!.smoothedRtt?.() ?? 0) / 2)))
        : 0;
      if (both) {
        this._scratch[1] = rk & 0xff;
        this._scratch[2] = (rk >>> 8) & 0xff;
        this._scratch[3] = (rk >>> 16) & 0xff;
        this._scratch[4] = (rk >>> 24) & 0xff;
        this._scratch[5] = delta & 0xff;
        this._scratch[6] = (delta >>> 8) & 0xff;
        this._scratch.set(bytes, 7);
      } else {
        // Single u32: reckonTime for reckon-only, renderTime (= reckon − delta)
        // for render-only.
        const stamp = (this._stampReckon ? rk : (rk > delta ? rk - delta : 0)) >>> 0;
        this._scratch[1] = stamp & 0xff;
        this._scratch[2] = (stamp >>> 8) & 0xff;
        this._scratch[3] = (stamp >>> 16) & 0xff;
        this._scratch[4] = (stamp >>> 24) & 0xff;
        this._scratch.set(bytes, 5);
      }
    } else {
      this._scratch[0] = this._encoder.mode === "reliable"
        ? Protocol.ROOM_INPUT_RELIABLE
        : Protocol.ROOM_INPUT_UNRELIABLE;
      this._scratch.set(bytes, 1);
    }

    if (this._framed === null || this._framed.byteLength !== total) {
      this._framed = this._scratch.subarray(0, total);   // reused view (size is stable)
    }
    const framed = this._framed;
    if (this._encoder.mode === "reliable") {
      conn.send(framed);
      // Reliable: implicit count seq — the server counts received messages, so
      // `_sentCount` mirrors its consumed counter for the next TIMED ack.
      this._recordSent(++this._sentCount);
    } else {
      conn.sendUnreliable(framed);
      // Unreliable: adopt the encoder's framework seq (stamped on the wire) so the
      // server's seq-value ack and this replay ring line up across packet loss.
      this._recordSent(this._sentCount = this._encoder.seq);
    }
  }

  /**
   * @internal Snapshot the just-sent input into the replay ring and stamp its
   * send time, keyed by `seq`. Lets a reconciler replay unacked inputs via
   * {@link at} and the TIMED ack sample RTT. The snapshot is alloc-free through
   * the codec's `copyInto` (no `Object.keys`); `delta:false` stages every field,
   * so each slot is a full snapshot.
   */
  private _recordSent(seq: number): void {
    if (this._inputBuffer === null) {
      const Ctor = (this.data as any).constructor;
      this._inputBuffer = Array.from({ length: this._inputBufferSize }, () => new Ctor() as I);
    }
    this._encoder.copyInto(this._inputBuffer[seq % this._inputBufferSize]);
    this._sendTimes[seq % InputHandleImpl.SEND_TIME_SIZE] = now();
  }

  /**
   * @internal Feed the server's last-PROCESSED input seq (decoded from the
   * TIMED prefix). Advances {@link lastProcessed} (monotonic) and returns the
   * round-trip time sample for that ack (`now − sendTime(seq)`), or `-1` if the
   * send time is unknown. The {@link RoomClock} filters/EMA-smooths the sample.
   */
  ackInput(seq: number): number {
    if (seq <= this._lastProcessed) return -1;
    // Aged out of the send-time ring → RTT unknown.
    const aged = this._sentCount - seq >= InputHandleImpl.SEND_TIME_SIZE;
    this._lastProcessed = seq;
    if (aged) return -1;
    const sentAt = this._sendTimes[seq % InputHandleImpl.SEND_TIME_SIZE];
    return sentAt > 0 ? now() - sentAt : -1;
  }
}

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
   *  to stay import-cycle free (the Room's RoomClockLike satisfies it). */
  clock?: { serverNow(): number };
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
   * Subtract this many ms from `clock.serverNow()` when auto-stamping the
   * render timestamp for render-time lag compensation. Set it to your
   * interpolation buffer delay so the stamp matches the server time you were
   * actually rendering remote entities at. Default `0` — stamp `serverNow()`
   * directly, correct when you dead-reckon remote entities to current server
   * time. Has no effect unless the Room enabled render-time via `defineInput()`.
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

  // Render-time lag comp (server INPUT_OPTIONS handshake): each reliable input gets a [uint32 renderTime] prefix.
  private _renderTime = false;
  private _renderDelay = 0;
  // Server-advertised rates: fixed step (Hz) and patch interval (ms = reconcile cadence).
  private _tickRate?: number;
  private _patchRate?: number;

  constructor(
    host: InputHandleHost,
    data: I,
    encoder: InputEncoder<any>,
    opts?: { renderTime?: boolean; renderDelay?: number; tickRate?: number; patchRate?: number },
  ) {
    this._host = host;
    this.data = data;
    this._encoder = encoder;
    this._renderTime = opts?.renderTime ?? false;
    this._renderDelay = opts?.renderDelay ?? 0;
    this._tickRate = opts?.tickRate;
    this._patchRate = opts?.patchRate;

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
    this._sentCount = 0;
    this._lastProcessed = 0;
    this._framed = null;
    // _sendTimes / _inputBuffer rings are reused (overwritten by future sends).
  }

  send(): void {
    const conn = this._host.connection;
    if (!conn?.isOpen) return;

    const bytes = this._encoder.encode();
    if (bytes.length === 0) return; // delta no-op — nothing to send, nothing to count

    // Render-time prefix (reliable only): OR the TIMED modifier onto the opcode and prepend
    // [uint32 renderTime LE] — server-clock ms (minus interp delay) we render at — for lag-comp rewind.
    const stampRender = this._renderTime && this._encoder.mode === "reliable";
    const prefixLen = stampRender ? 4 : 0;
    const total = 1 + prefixLen + bytes.length;
    if (total > this._scratch.byteLength) {
      this._scratch = new Uint8Array(Math.max(total, this._scratch.byteLength * 2));
      this._framed = null;   // cached view points into the old buffer
    }
    if (stampRender) {
      this._scratch[0] = Protocol.ROOM_INPUT_RELIABLE | ProtocolModifier.TIMED;
      const rt = Math.max(0, Math.round((this._host.clock?.serverNow() ?? 0) - this._renderDelay)) >>> 0;
      this._scratch[1] = rt & 0xff;
      this._scratch[2] = (rt >>> 8) & 0xff;
      this._scratch[3] = (rt >>> 16) & 0xff;
      this._scratch[4] = (rt >>> 24) & 0xff;
      this._scratch.set(bytes, 5);
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
      // `_sentCount` mirrors the server's consumed counter, so the next TIMED ack can prune + sample RTT.
      const seq = ++this._sentCount;
      // Snapshot into the replay ring via the codec — alloc-free, no Object.keys. Reliable + delta:false stages every field, so it's a full snapshot.
      if (this._inputBuffer === null) {
        const Ctor = (this.data as any).constructor;
        this._inputBuffer = Array.from({ length: this._inputBufferSize }, () => new Ctor() as I);
      }
      this._encoder.copyInto(this._inputBuffer[seq % this._inputBufferSize]);
      // RTT: stamp send time in the ring.
      this._sendTimes[seq % InputHandleImpl.SEND_TIME_SIZE] = now();
    } else {
      conn.sendUnreliable(framed);
    }
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

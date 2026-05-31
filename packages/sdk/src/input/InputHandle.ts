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

  // Input round-trip state (per client per room — one handle per room). Owns
  // the send counter + send-time table for RTT, and the server-acked count.
  private static readonly SEND_TIME_TABLE_MAX = 256;
  private _sentCount = 0;                       // reliable inputs transmitted
  private _lastProcessed = 0;                   // server-acked (consumedCount)
  private _sentTimes = new Map<number, number>(); // seq → client send time (RTT)

  // Sent-input ring for client-side reconciliation/replay — the mirror of the
  // server's per-client input buffer. Each reliable send snapshots `data` into a
  // reused slot keyed by `seq % size` (overwritten in place via Schema#assign —
  // NO per-send allocation), so a reconciler can replay the unacked inputs
  // without owning its own copy. Sized well above any realistic in-flight count
  // (RTT × send-rate); older entries age out (a reconcile that far behind pops).
  private static readonly INPUT_BUFFER_SIZE = 64;
  private _inputBuffer: I[] | null = null;      // lazily allocated (needs data ctor)

  // Render-time lag comp — enabled by the server's INPUT_OPTIONS handshake.
  // When on, each reliable input carries a [uint32 renderTime] prefix.
  private _renderTime = false;
  private _renderDelay = 0;

  constructor(
    host: InputHandleHost,
    data: I,
    encoder: InputEncoder<any>,
    opts?: { renderTime?: boolean; renderDelay?: number },
  ) {
    this._host = host;
    this.data = data;
    this._encoder = encoder;
    this._renderTime = opts?.renderTime ?? false;
    this._renderDelay = opts?.renderDelay ?? 0;
  }

  get mode(): InputMode { return this._encoder.mode; }
  get lastProcessed(): number { return this._lastProcessed; }
  get sentCount(): number { return this._sentCount; }
  get pendingCount(): number { return this._sentCount - this._lastProcessed; }

  at(seq: number): I | undefined {
    if (this._inputBuffer === null) return undefined;
    // Buffered iff sent, not yet acked, and still within the bounded ring window.
    if (seq <= this._lastProcessed || seq > this._sentCount) return undefined;
    if (this._sentCount - seq >= InputHandleImpl.INPUT_BUFFER_SIZE) return undefined;
    return this._inputBuffer[seq % InputHandleImpl.INPUT_BUFFER_SIZE];
  }

  reset(): void {
    this._encoder.reset();
    this._sentCount = 0;
    this._lastProcessed = 0;
    this._sentTimes.clear();
  }

  send(): void {
    const conn = this._host.connection;
    if (!conn?.isOpen) return;

    const bytes = this._encoder.encode();
    if (bytes.length === 0) return; // delta no-op — nothing to send, nothing to count

    // Render-time prefix: reliable inputs only (phase 1). When enabled, OR the
    // TIMED modifier onto the opcode and prepend [uint32 renderTime LE] — the
    // server-clock ms (minus any interp delay) we're rendering the world at —
    // so the server can rewind other entities for lag-compensated hits.
    const stampRender = this._renderTime && this._encoder.mode === "reliable";
    const prefixLen = stampRender ? 4 : 0;
    const total = 1 + prefixLen + bytes.length;
    if (total > this._scratch.byteLength) {
      this._scratch = new Uint8Array(Math.max(total, this._scratch.byteLength * 2));
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

    const framed = this._scratch.subarray(0, total);
    if (this._encoder.mode === "reliable") {
      conn.send(framed);
      // Count + stamp this transmit. `_sentCount` mirrors the server's
      // per-client received/consumed counter, so the next TIMED ack
      // (`ackInput`) can both prune pending inputs and produce an RTT sample.
      const seq = ++this._sentCount;
      // Snapshot into the reused reconciliation ring — overwrite the slot in
      // place (no allocation after the one-time warm-up).
      if (this._inputBuffer === null) {
        const Ctor = (this.data as any).constructor;
        this._inputBuffer = Array.from({ length: InputHandleImpl.INPUT_BUFFER_SIZE }, () => new Ctor() as I);
      }
      (this._inputBuffer[seq % InputHandleImpl.INPUT_BUFFER_SIZE] as any).assign(this.data);
      if (this._sentTimes.size >= InputHandleImpl.SEND_TIME_TABLE_MAX) {
        const oldest = this._sentTimes.keys().next().value;
        if (oldest !== undefined) this._sentTimes.delete(oldest);
      }
      this._sentTimes.set(seq, now());
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
    this._lastProcessed = seq;
    const sentAt = this._sentTimes.get(seq);
    // Evict acknowledged send-times (and any older).
    for (const k of this._sentTimes.keys()) {
      if (k <= seq) this._sentTimes.delete(k);
      else break;
    }
    return sentAt !== undefined ? now() - sentAt : -1;
  }
}

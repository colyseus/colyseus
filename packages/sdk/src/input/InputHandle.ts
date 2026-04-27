import { InputEncoder, type InputEncoderOptions, type InputMode } from '@colyseus/schema/input';
import { Protocol } from '@colyseus/shared-types';

import type { Connection } from '../Connection.ts';

/**
 * Minimal structural type the input handle needs from its host (Room). Lets
 * us decouple from the full `Room` class so this module stays import-cycle
 * free, while still picking up the latest `connection` after a reconnect.
 *
 * @internal
 */
export interface InputHandleHost {
  connection?: Connection;
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
export interface ClientInputOptions<I = any> extends InputEncoderOptions {
  /**
   * Schema constructor for the input. Required when server-sent reflection
   * isn't available (which is the default today). Once handshake-time input
   * reflection lands, `type` becomes optional.
   */
  type?: new () => I;
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
export interface ClientInputHandle<I = any> {
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
}

/** @internal */
export class ClientInputHandleImpl<I = any> implements ClientInputHandle<I> {
  public readonly data: I;
  private _host: InputHandleHost;
  private _encoder: InputEncoder<any>;
  private _scratch: Uint8Array = new Uint8Array(2048);

  constructor(host: InputHandleHost, data: I, encoder: InputEncoder<any>) {
    this._host = host;
    this.data = data;
    this._encoder = encoder;
  }

  get mode(): InputMode { return this._encoder.mode; }

  reset(): void { this._encoder.reset(); }

  send(): void {
    const conn = this._host.connection;
    if (!conn?.isOpen) return;

    const bytes = this._encoder.encode();
    if (bytes.length === 0) return;

    const total = 1 + bytes.length;
    if (total > this._scratch.byteLength) {
      this._scratch = new Uint8Array(Math.max(total, this._scratch.byteLength * 2));
    }
    this._scratch[0] = this._encoder.mode === "reliable"
      ? Protocol.ROOM_INPUT_RELIABLE
      : Protocol.ROOM_INPUT_UNRELIABLE;
    this._scratch.set(bytes, 1);

    const framed = this._scratch.subarray(0, total);
    if (this._encoder.mode === "reliable") {
      conn.send(framed);
    } else {
      conn.sendUnreliable(framed);
    }
  }
}

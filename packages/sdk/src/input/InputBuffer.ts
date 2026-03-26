import type { Room } from '../Room.ts';
import { createSignal } from '../core/signal.ts';

export interface InputBufferOptions {
  /**
   * The message type to use when sending inputs via room.send().
   * @default "input"
   */
  type?: string | number;

  /**
   * Number of redundant previous inputs to include in each message.
   * Only useful with unreliable transports (H3/WebTransport).
   * When 0 (default), sends via room.send() as `[seq, data]`.
   * When > 0, sends via room.sendUnreliable() with last N inputs.
   * @default 0
   */
  redundancy?: number;

  /**
   * Maximum number of unconfirmed inputs to keep in the buffer.
   * Oldest entries are dropped when exceeded.
   * @default 512
   */
  maxBufferSize?: number;
}

export interface InputEntry<I> {
  seq: number;
  input: I;
}

/**
 * Client-side input buffer for client-side prediction.
 *
 * Tracks inputs with auto-incrementing sequence numbers, sends them to
 * the server, and maintains a buffer of unconfirmed inputs for reconciliation.
 *
 * @example
 * ```typescript
 * const inputs = room.input<{ dx: number; dy: number }>();
 *
 * // Push input (sends to server + buffers locally)
 * inputs.push({ dx: 1, dy: 0 });
 *
 * // Reconcile when server state arrives
 * room.onStateChange((state) => {
 *   const me = state.players.get(room.sessionId);
 *   inputs.confirm(me.lastProcessedSeq);
 *
 *   // Re-apply pending inputs on top of server state
 *   for (const { input } of inputs.pending) {
 *     // apply prediction...
 *   }
 * });
 * ```
 */
export class InputBuffer<I = any> {
  /**
   * Signal invoked after confirm() removes entries.
   * Callback receives the confirmed sequence number.
   */
  public onConfirm = createSignal<(seq: number) => void>();

  /**
   * The last sequence number confirmed by the server.
   * -1 means no inputs have been confirmed yet.
   */
  public lastConfirmedSeq: number = -1;

  /**
   * Buffer of pending (unconfirmed) inputs, ordered by sequence number.
   */
  public get pending(): ReadonlyArray<InputEntry<I>> {
    return this._pending;
  }

  /**
   * The next sequence number that will be assigned.
   */
  public get nextSeq(): number {
    return this._nextSeq;
  }

  private _pending: InputEntry<I>[] = [];
  private _nextSeq: number = 0;

  private _room: Room;
  private _type: string | number;
  private _redundancy: number;
  private _maxBufferSize: number;

  private _onReconnectHandler: () => void;

  constructor(room: Room, options?: InputBufferOptions) {
    this._room = room;
    this._type = options?.type ?? "input";
    this._redundancy = options?.redundancy ?? 0;
    this._maxBufferSize = options?.maxBufferSize ?? 512;

    // Reset on reconnect — server state is authoritative after reconnection.
    this._onReconnectHandler = () => this.reset();
    room.onReconnect(this._onReconnectHandler);
  }

  /**
   * Push a new input into the buffer and send it to the server.
   *
   * @param input - The input data to send
   * @returns The sequence number assigned to this input
   */
  push(input: I): number {
    const seq = this._nextSeq++;
    this._pending.push({ seq, input });

    // Enforce max buffer size
    if (this._pending.length > this._maxBufferSize) {
      this._pending.shift();
    }

    if (this._redundancy > 0) {
      // Unreliable mode: include last N inputs as array of [seq, data] tuples
      const startIdx = Math.max(0, this._pending.length - this._redundancy - 1);
      const tuples: [number, I][] = [];
      for (let i = startIdx; i < this._pending.length; i++) {
        tuples.push([this._pending[i].seq, this._pending[i].input]);
      }
      this._room.sendUnreliable(this._type, tuples);
    } else {
      // Reliable mode: send [seq, inputData]
      this._room.send(this._type as any, [seq, input] as any);
    }

    return seq;
  }

  /**
   * Confirm that the server has processed all inputs up to and including `seq`.
   * Removes confirmed inputs from the pending buffer and fires onConfirm.
   * Idempotent — ignores seq <= lastConfirmedSeq.
   *
   * @param seq - The sequence number the server has processed up to
   */
  confirm(seq: number): void {
    if (seq <= this.lastConfirmedSeq) {
      return;
    }

    this.lastConfirmedSeq = seq;

    while (this._pending.length > 0 && this._pending[0].seq <= seq) {
      this._pending.shift();
    }

    this.onConfirm.invoke(seq);
  }

  /**
   * Reset the buffer to its initial state.
   * Called automatically on reconnection.
   */
  reset(): void {
    this._pending.length = 0;
    this._nextSeq = 0;
    this.lastConfirmedSeq = -1;
  }

  /**
   * Clean up listeners. Call when the InputBuffer is no longer needed.
   */
  dispose(): void {
    this._room.onReconnect.remove(this._onReconnectHandler as any);
    this.onConfirm.clear();
    this._pending.length = 0;
  }
}

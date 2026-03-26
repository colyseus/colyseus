import type { Client } from './Transport.ts';

/**
 * Key used to store the last processed sequence number on client.userData.
 * Uses a Symbol to avoid collisions with user-defined userData properties.
 */
const LAST_PROCESSED_SEQ = Symbol.for('colyseus:lastProcessedSeq');

export interface ProcessInputsOptions {
  /**
   * Key on client.userData to store the last processed sequence number.
   * Defaults to a Symbol, but can be overridden with a string key if
   * the userData type needs to be aware of it.
   * @default Symbol.for('colyseus:lastProcessedSeq')
   */
  seqKey?: string | symbol;
}

/**
 * Process client inputs with automatic deduplication and sequence tracking.
 *
 * Handles both reliable format `[seq, data]` and unreliable/redundant
 * format `[[seq, data], [seq-1, data], ...]`.
 *
 * For each input whose `seq` is greater than the client's last processed
 * sequence number, the callback is invoked with the input data and
 * sequence number. Inputs are always processed in ascending seq order.
 *
 * The last processed sequence number is stored on `client.userData`
 * using a Symbol key by default.
 *
 * @param client - The client that sent the message
 * @param message - The raw message payload (from room.onMessage callback)
 * @param callback - Called for each new (non-duplicate) input
 * @param options - Optional configuration
 * @returns The latest processed sequence number, or -1 if no inputs were processed
 *
 * @example
 * ```typescript
 * this.onMessage("input", (client, message) => {
 *   processInputs<MoveInput>(client, message, (input, seq) => {
 *     const player = this.state.players.get(client.sessionId);
 *     player.x += input.dx * SPEED;
 *     player.y += input.dy * SPEED;
 *     player.lastProcessedSeq = seq;
 *   });
 * });
 * ```
 */
export function processInputs<I>(
  client: Client,
  message: [number, I] | Array<[number, I]>,
  callback: (input: I, seq: number) => void,
  options?: ProcessInputsOptions,
): number {
  const seqKey = options?.seqKey ?? LAST_PROCESSED_SEQ;

  if (client.userData === undefined || client.userData === null) {
    client.userData = {};
  }

  const lastProcessed: number = client.userData[seqKey] ?? -1;
  let latestSeq = lastProcessed;

  if (isReliableFormat(message)) {
    const [seq, data] = message;
    if (seq > lastProcessed) {
      callback(data, seq);
      latestSeq = seq;
    }
  } else {
    // Unreliable/redundant: array of [seq, data] tuples
    const tuples = message as Array<[number, I]>;
    tuples.sort((a, b) => a[0] - b[0]);

    for (let i = 0; i < tuples.length; i++) {
      const [seq, data] = tuples[i];
      if (seq > lastProcessed && seq > latestSeq) {
        callback(data, seq);
        latestSeq = seq;
      }
    }
  }

  if (latestSeq > lastProcessed) {
    client.userData[seqKey] = latestSeq;
  }

  return latestSeq;
}

/**
 * Reset the input sequence tracking for a client.
 * Call this in your Room's onReconnect() handler so that
 * the reconnected client's inputs (starting from seq 0) are accepted.
 *
 * @param client - The reconnected client
 * @param options - Must match the options passed to processInputs if custom seqKey is used
 */
export function resetInputSequence(client: Client, options?: ProcessInputsOptions): void {
  const seqKey = options?.seqKey ?? LAST_PROCESSED_SEQ;
  if (client.userData) {
    client.userData[seqKey] = -1;
  }
}

/**
 * Detect whether the message is in reliable format [seq, data]
 * vs unreliable format [[seq, data], ...].
 */
function isReliableFormat(message: any): message is [number, any] {
  return typeof message[0] === 'number';
}

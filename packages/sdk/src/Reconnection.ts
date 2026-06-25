import type { Room } from './Room.ts';

export interface ReconnectionOptions {
    /**
     * Whether automatic reconnection is enabled.
     * Set to `false` to disable automatic reconnection entirely.
     * @default true
     */
    enabled: boolean;

    /**
     * The maximum number of reconnection attempts.
     */
    maxRetries: number;

    /**
     * The minimum delay between reconnection attempts.
     */
    minDelay: number;

    /**
     * The maximum delay between reconnection attempts.
     */
    maxDelay: number;

    /**
     * The minimum uptime of the room before reconnection attempts can be made.
     */
    minUptime: number;

    /**
     * The current number of reconnection attempts.
     */
    retryCount: number;

    /**
     * The initial delay between reconnection attempts.
     */
    delay: number;

    /**
     * The function to calculate the delay between reconnection attempts.
     * @param attempt - The current attempt number.
     * @param delay - The initial delay between reconnection attempts.
     * @returns The delay between reconnection attempts.
     */
    backoff: (attempt: number, delay: number) => number;

    /**
     * The maximum number of enqueued messages to buffer.
     */
    maxEnqueuedMessages: number;

    /**
     * Buffer for messages sent while connection is not open.
     * These messages will be sent once the connection is re-established.
     */
    enqueuedMessages: Array<{ data: Uint8Array }>;

    /**
     * Whether the room is currently reconnecting.
     */
    isReconnecting: boolean;
}

/** Fresh per-room reconnection config + buffer state (defaults). One per `Room`
 *  instance — `enqueuedMessages` must not be shared. */
export function createReconnection(): ReconnectionOptions {
    return {
        enabled: true,
        retryCount: 0,
        maxRetries: 15,
        delay: 100,
        minDelay: 100,
        maxDelay: 5000,
        minUptime: 5000,
        backoff: exponentialBackoff,
        maxEnqueuedMessages: 10,
        enqueuedMessages: [],
        isReconnecting: false,
    };
}

export const exponentialBackoff = (attempt: number, delay: number) => {
    return Math.floor(Math.pow(2, attempt) * delay);
};

/** Buffer a message to flush on (re)connect, evicting the oldest past the cap. */
export function enqueueMessage(room: Room, message: Uint8Array) {
    room.reconnection.enqueuedMessages.push({ data: message });
    if (room.reconnection.enqueuedMessages.length > room.reconnection.maxEnqueuedMessages) {
        room.reconnection.enqueuedMessages.shift();
    }
}

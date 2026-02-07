import { CloseCode, Protocol, type InferState, type NormalizeRoomType, type ExtractRoomMessages, type ExtractRoomClientMessages, type ExtractMessageType } from '@colyseus/shared-types';
import { decode, Decoder, encode, Iterator, Schema } from '@colyseus/schema';

import { Packr, unpack } from '@colyseus/msgpackr';

import { Connection } from './Connection.ts';
import { getSerializer, Serializer } from './serializer/Serializer.ts';

// The unused imports here are important for better `.d.ts` file generation
// (Later merged with `dts-bundle-generator`)
import { createNanoEvents } from './core/nanoevents.ts';
import { createSignal } from './core/signal.ts';

import { SchemaConstructor, SchemaSerializer } from './serializer/SchemaSerializer.ts';

import { now } from './core/utils.ts';

// Infer serializer type based on State: SchemaSerializer for Schema types, Serializer otherwise
export type InferSerializer<State> = [State] extends [Schema]
    ? SchemaSerializer<State>
    : Serializer<State>;

export interface RoomAvailable<Metadata = any> {
    name: string;
    roomId: string;
    clients: number;
    maxClients: number;
    metadata?: Metadata;
}

export interface ReconnectionOptions {
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

export class Room<
    T = any,
    State = InferState<T, never>,
> {
    public roomId: string;
    public sessionId: string;
    public reconnectionToken: string;

    public name: string;
    public connection: Connection;

    // Public signals
    public onStateChange = createSignal<(state: State) => void>();
    public onError = createSignal<(code: number, message?: string) => void>();
    public onLeave = createSignal<(code: number, reason?: string) => void>();

    public onReconnect = createSignal<() => void>();
    public onDrop = createSignal<(code: number, reason?: string) => void>();

    protected onJoin = createSignal();

    public serializerId: string;
    public serializer: InferSerializer<State>;

    // reconnection logic
    public reconnection: ReconnectionOptions = {
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

    protected joinedAtTime: number = 0;

    protected onMessageHandlers = createNanoEvents();

    protected packr: Packr;

    #lastPingTime: number = 0;
    #pingCallback?: (ms: number) => void = undefined;

    constructor(name: string, rootSchema?: SchemaConstructor<State>) {
        this.name = name;

        this.packr = new Packr();

        // msgpackr workaround: force buffer to be created.
        this.packr.encode(undefined);

        if (rootSchema) {
            const serializer: SchemaSerializer = new (getSerializer("schema"));
            this.serializer = serializer;

            const state: State = new rootSchema();
            serializer.state = state;
            serializer.decoder = new Decoder(state as Schema);
        }

        this.onLeave(() => {
            this.removeAllListeners();
            this.destroy();
        });
    }

    public connect(endpoint: string, options?: any, headers?: any) {
        this.connection = new Connection(options.protocol);
        this.connection.events.onmessage = this.onMessageCallback.bind(this);
        this.connection.events.onclose = (e: CloseEvent) => {
            if (this.joinedAtTime === 0) {
                console.warn?.(`Room connection was closed unexpectedly (${e.code}): ${e.reason}`);
                this.onError.invoke(e.code, e.reason);
                return;
            }

            if (
                e.code === CloseCode.NO_STATUS_RECEIVED ||
                e.code === CloseCode.ABNORMAL_CLOSURE ||
                e.code === CloseCode.GOING_AWAY ||
                e.code === CloseCode.MAY_TRY_RECONNECT
            ) {
                this.onDrop.invoke(e.code, e.reason);
                this.handleReconnection();

            } else {
                this.onLeave.invoke(e.code, e.reason);
            }
        };

        this.connection.events.onerror = (e: CloseEvent) => {
            this.onError.invoke(e.code, e.reason);
        };

        /**
         * if local serializer has state, it means we don't need to receive the
         * handshake from the server
         */
        const skipHandshake = (this.serializer?.getState() !== undefined);

        if (options.protocol === "h3") {
            // FIXME: refactor this.
            const url = new URL(endpoint);
            this.connection.connect(url.origin, { ...options, skipHandshake });

        } else {
            this.connection.connect(`${endpoint}${skipHandshake ? "&skipHandshake=1" : ""}`, headers);
        }

    }

    public leave(consented: boolean = true): Promise<number> {
        return new Promise((resolve) => {
            this.onLeave((code) => resolve(code));

            if (this.connection) {
                if (consented) {
                    this.packr.buffer[0] = Protocol.LEAVE_ROOM;
                    this.connection.send(this.packr.buffer.subarray(0, 1));

                } else {
                    this.connection.close();
                }

            } else {
                this.onLeave.invoke(CloseCode.CONSENTED);
            }
        });
    }

    public onMessage<MessageType extends keyof ExtractRoomClientMessages<NormalizeRoomType<T>>>(
        message: MessageType,
        callback: (payload: ExtractRoomClientMessages<NormalizeRoomType<T>>[MessageType]) => void
    ): () => void
    public onMessage<Payload = any>(type: "*", callback: (messageType: string | number, payload: Payload) => void): () => void
    // Fallback overload: only available when no typed client messages are defined
    public onMessage<Payload = any>(
        type: [keyof ExtractRoomClientMessages<NormalizeRoomType<T>>] extends [never] ? (string | number) : never,
        callback: (payload: Payload) => void
    ): () => void
    public onMessage(type: '*' | string | number, callback: (...args: any[]) => void) {
        return this.onMessageHandlers.on(this.getMessageHandlerKey(type), callback);
    }

    public ping(callback: (ms: number) => void) {
        // skip if connection is not open
        if (!this.connection?.isOpen) {
            return;
        }

        this.#lastPingTime = now();
        this.#pingCallback = callback;
        this.packr.buffer[0] = Protocol.PING;
        this.connection.send(this.packr.buffer.subarray(0, 1));
    }

    public send<MessageType extends keyof ExtractRoomMessages<NormalizeRoomType<T>>>(
        messageType: MessageType,
        payload?: ExtractMessageType<ExtractRoomMessages<NormalizeRoomType<T>>[MessageType]>
    ): void
    // Fallback overload: only available when no typed messages are defined
    public send<Payload = any>(
        messageType: [keyof ExtractRoomMessages<NormalizeRoomType<T>>] extends [never] ? (string | number) : never,
        payload?: Payload
    ): void
    public send(messageType: string | number, payload?: any): void {
        const it: Iterator = { offset: 1 };
        this.packr.buffer[0] = Protocol.ROOM_DATA;

        if (typeof(messageType) === "string") {
            encode.string(this.packr.buffer as Buffer, messageType, it);

        } else {
            encode.number(this.packr.buffer as Buffer, messageType, it);
        }

        // force packr to use beginning of the buffer
        this.packr.position = 0;

        const data = (payload !== undefined)
            ? this.packr.pack(payload, 2048 + it.offset) // 2048 = RESERVE_START_SPACE
            : this.packr.buffer.subarray(0, it.offset);

        // If connection is not open, buffer the message
        if (!this.connection.isOpen) {
            enqueueMessage(this, new Uint8Array(data));
        } else {
            this.connection.send(data);
        }
    }

    public sendUnreliable<T = any>(type: string | number, message?: T): void {
        // If connection is not open, skip
        if (!this.connection.isOpen) { return; }

        const it: Iterator = { offset: 1 };
        this.packr.buffer[0] = Protocol.ROOM_DATA;

        if (typeof(type) === "string") {
            encode.string(this.packr.buffer as Buffer, type, it);

        } else {
            encode.number(this.packr.buffer as Buffer, type, it);
        }

        // force packr to use beginning of the buffer
        this.packr.position = 0;

        const data = (message !== undefined)
            ? this.packr.pack(message, 2048 + it.offset) // 2048 = RESERVE_START_SPACE
            : this.packr.buffer.subarray(0, it.offset);

        this.connection.sendUnreliable(data);
    }

    public sendBytes(type: string | number, bytes: Uint8Array) {
        const it: Iterator = { offset: 1 };
        this.packr.buffer[0] = Protocol.ROOM_DATA_BYTES;

        if (typeof(type) === "string") {
            encode.string(this.packr.buffer as Buffer, type, it);

        } else {
            encode.number(this.packr.buffer as Buffer, type, it);
        }

        // check if buffer needs to be resized
        // TODO: can we avoid this?
        if (bytes.byteLength + it.offset > this.packr.buffer.byteLength) {
            const newBuffer = new Uint8Array(it.offset + bytes.byteLength);
            newBuffer.set(this.packr.buffer);
            this.packr.useBuffer(newBuffer);
        }

        this.packr.buffer.set(bytes, it.offset);

        // If connection is not open, buffer the message
        if (!this.connection.isOpen) {
            enqueueMessage(this, this.packr.buffer.subarray(0, it.offset + bytes.byteLength));
        } else {
            this.connection.send(this.packr.buffer.subarray(0, it.offset + bytes.byteLength));
        }

    }

    public get state (): State {
        return this.serializer.getState();
    }

    public removeAllListeners() {
        this.onJoin.clear();
        this.onStateChange.clear();
        this.onError.clear();
        this.onLeave.clear();
        this.onReconnect.clear();
        this.onDrop.clear();
        this.onMessageHandlers.events = {};

        if (this.serializer instanceof SchemaSerializer) {
            // Remove callback references
            this.serializer.decoder.root.callbacks = {};
        }
    }

    protected onMessageCallback(event: MessageEvent) {
        const buffer = new Uint8Array(event.data);

        const it: Iterator = { offset: 1 };
        const code = buffer[0];

        if (code === Protocol.JOIN_ROOM) {
            const reconnectionToken = decode.utf8Read(buffer as Buffer, it, buffer[it.offset++]);
            this.serializerId = decode.utf8Read(buffer as Buffer, it, buffer[it.offset++]);

            // Instantiate serializer if not locally available.
            if (!this.serializer) {
                const serializer = getSerializer(this.serializerId);
                this.serializer = new serializer();
            }

            // apply handshake on first join (no need to do this on reconnect)
            if (buffer.byteLength > it.offset && this.serializer.handshake) {
                this.serializer.handshake(buffer, it);
            }

            if (this.joinedAtTime === 0) {
                this.joinedAtTime = Date.now();
                this.onJoin.invoke();

            } else {
                console.info(`[Colyseus reconnection]: ${String.fromCodePoint(0x2705)} reconnection successful!`); // ✅
                this.reconnection.isReconnecting = false;
                this.onReconnect.invoke();
            }

            this.reconnectionToken = `${this.roomId}:${reconnectionToken}`;

            // acknowledge successfull JOIN_ROOM
            this.packr.buffer[0] = Protocol.JOIN_ROOM;
            this.connection.send(this.packr.buffer.subarray(0, 1));

            // Send any enqueued messages that were buffered while disconnected
            if (this.reconnection.enqueuedMessages.length > 0) {
                for (const message of this.reconnection.enqueuedMessages) {
                    this.connection.send(message.data);
                }
                // Clear the buffer after sending
                this.reconnection.enqueuedMessages = [];
            }

        } else if (code === Protocol.ERROR) {
            const code = decode.number(buffer as Buffer, it);
            const message = decode.string(buffer as Buffer, it);

            this.onError.invoke(code, message);

        } else if (code === Protocol.LEAVE_ROOM) {
            this.leave();

        } else if (code === Protocol.ROOM_STATE) {
            this.serializer.setState(buffer, it);
            this.onStateChange.invoke(this.serializer.getState());

        } else if (code === Protocol.ROOM_STATE_PATCH) {
            this.serializer.patch(buffer, it);
            this.onStateChange.invoke(this.serializer.getState());

        } else if (code === Protocol.ROOM_DATA) {
            const type = (decode.stringCheck(buffer as Buffer, it))
                ? decode.string(buffer as Buffer, it)
                : decode.number(buffer as Buffer, it);

            const message = (buffer.byteLength > it.offset)
                ? unpack(buffer as Buffer, { start: it.offset })
                : undefined;

            this.dispatchMessage(type, message);

        } else if (code === Protocol.ROOM_DATA_BYTES) {
            const type = (decode.stringCheck(buffer as Buffer, it))
                ? decode.string(buffer as Buffer, it)
                : decode.number(buffer as Buffer, it);

            this.dispatchMessage(type, buffer.subarray(it.offset));

        } else if (code === Protocol.PING) {
            this.#pingCallback?.(Math.round(now() - this.#lastPingTime));
            this.#pingCallback = undefined;
        }
    }

    private dispatchMessage(type: string | number, message: any) {
        const messageType = this.getMessageHandlerKey(type);

        if (this.onMessageHandlers.events[messageType]) {
            this.onMessageHandlers.emit(messageType, message);

        } else if (this.onMessageHandlers.events['*']) {
            this.onMessageHandlers.emit('*', type, message);

        } else if (!messageType.startsWith("__")) { // ignore internal messages
            console.warn?.(`@colyseus/sdk: onMessage() not registered for type '${type}'.`);
        }
    }

    private destroy () {
        if (this.serializer) {
            this.serializer.teardown();
        }
    }

    private getMessageHandlerKey(type: string | number): string {
        switch (typeof(type)) {
            // string
            case "string": return type;

            // number
            case "number": return `i${type}`;

            default: throw new Error("invalid message type.");
        }
    }

    private handleReconnection() {
        if (Date.now() - this.joinedAtTime < this.reconnection.minUptime) {
            console.info(`[Colyseus reconnection]: ${String.fromCodePoint(0x274C)} Room has not been up for long enough for automatic reconnection. (min uptime: ${this.reconnection.minUptime}ms)`); // ❌
            this.onLeave.invoke(CloseCode.ABNORMAL_CLOSURE, "Room uptime too short for reconnection.");
            return;
        }

        if (!this.reconnection.isReconnecting) {
            this.reconnection.retryCount = 0;
            this.reconnection.isReconnecting = true;
        }

        this.retryReconnection();
    }

    private retryReconnection() {
        if (this.reconnection.retryCount >= this.reconnection.maxRetries) {
            // No more retries
            console.info(`[Colyseus reconnection]: ${String.fromCodePoint(0x274C)} ❌ Reconnection failed after ${this.reconnection.maxRetries} attempts.`); // ❌
            this.reconnection.isReconnecting = false;
            this.onLeave.invoke(CloseCode.FAILED_TO_RECONNECT, "No more retries. Reconnection failed.");
            return;
        }

        this.reconnection.retryCount++;

        const delay = Math.min(this.reconnection.maxDelay, Math.max(this.reconnection.minDelay, this.reconnection.backoff(this.reconnection.retryCount, this.reconnection.delay)));
        console.info(`[Colyseus reconnection]: ${String.fromCodePoint(0x023F3)} will retry in ${(delay/1000).toFixed(1)} seconds...`); // 🔄

        // Wait before attempting reconnection
        setTimeout(() => {
            try {
                console.info(`[Colyseus reconnection]: ${String.fromCodePoint(0x1F504)} Re-establishing sessionId '${this.sessionId}' with roomId '${this.roomId}'... (attempt ${this.reconnection.retryCount} of ${this.reconnection.maxRetries})`); // 🔄
                this.connection.reconnect({
                    reconnectionToken: this.reconnectionToken.split(":")[1],
                    skipHandshake: true, // we already applied the handshake on first join
                });

            } catch (e) {
                this.retryReconnection();
            }
        }, delay);
    }
}

const exponentialBackoff = (attempt: number, delay: number) => {
    return Math.floor(Math.pow(2, attempt) * delay);
}

function enqueueMessage(room: Room, message: Uint8Array) {
    room.reconnection.enqueuedMessages.push({ data: message });
    if (room.reconnection.enqueuedMessages.length > room.reconnection.maxEnqueuedMessages) {
        room.reconnection.enqueuedMessages.shift();
    }
}
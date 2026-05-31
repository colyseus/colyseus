import { CloseCode, HandshakeSection, InputFlags, Protocol, PROTOCOL_CODE_MASK, PROTOCOL_MODIFIER_MASK, ProtocolModifier, ResponseStatus, type InferState, type InferInput, type NormalizeRoomType, type ExtractRoomMessages, type ExtractRoomClientMessages, type ExtractMessageType, type ExtractResponseType } from '@colyseus/shared-types';
import { decode, Decoder, encode, Iterator, Reflection, Schema } from '@colyseus/schema';
import { InputEncoder } from '@colyseus/schema/input';

import { InputHandleImpl, type InputHandle, type InputOptions } from './input/InputHandle.ts';
export { type InputHandle, type InputOptions } from './input/InputHandle.ts';

import { Packr, unpack, RESERVE_START_SPACE } from 'msgpackr';

import { Connection } from './Connection.ts';
import { getSerializer, Serializer } from './serializer/Serializer.ts';

// The unused imports here are important for better `.d.ts` file generation
// (Later merged with `dts-bundle-generator`)
import { createNanoEvents } from './core/nanoevents.ts';
import { createSignal } from './core/signal.ts';

import { SchemaConstructor, SchemaSerializer } from './serializer/SchemaSerializer.ts';

import { NULL_CLOCK, RoomClock, type RoomClockLike } from './RoomClock.ts';

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

    protected joinedAtTime: number = 0;

    /**
     * Server-time + RTT estimator, driven by the {@link ProtocolModifier.TIMED}
     * prefix that servers emit when `defineInput()` was called.
     *
     * - Defaults to a shared frozen {@link NULL_CLOCK} so `room.clock.serverNow()`
     *   always works. The shim returns the client's own `performance.now()` and
     *   reports `0` for RTT. Rooms that never call `defineInput()` keep this
     *   stub for the whole session — zero allocation cost for chat / lobby /
     *   turn-based rooms.
     * - After handshake on an input room, a default {@link RoomClock} is
     *   instantiated. Users can swap their own implementation in via
     *   `room.clock = new MyClock()` between `await joinOrCreate(...)` and
     *   the first state message (any state-message arrival is on a future
     *   microtask, so a synchronous swap is race-free).
     * - Access timing through `room.clock.serverNow()` etc. directly — no
     *   optional chaining or fallback needed.
     */
    public clock: RoomClockLike = NULL_CLOCK;

    protected onMessageHandlers = createNanoEvents();

    protected packr: Packr;
    protected sharedBuffer: Uint8Array;

    #lastPingTime: number = 0;
    #pingCallback?: (ms: number) => void = undefined;

    /**
     * Default time (ms) a `room.request()` / `room.send(..., callback)` waits
     * for a reply before rejecting. Override per-call with the `timeout`
     * option. Tune globally by assigning to this field after joining.
     */
    public requestTimeout: number = 10000;

    /** Monotonic id correlating a {@link Protocol.ROOM_REQUEST} with its reply. @internal */
    #nextRequestId: number = 0;

    /** In-flight requests awaiting a {@link Protocol.ROOM_RESPONSE}. @internal */
    #pendingRequests = new Map<number, {
        resolve: (value: any) => void;
        reject: (reason: any) => void;
        timer: ReturnType<typeof setTimeout>;
    }>();

    // Impl type (not the public interface) so the TIMED decode can feed it the
    // server ack via the internal `ackInput()`.
    #inputHandle?: InputHandleImpl<any>;
    /**
     * Schema constructor recovered via Reflection from the server's
     * handshake (the `INPUT_REFLECTION` tagged section). Populated on JOIN
     * when the server room called `defineInput()`; falls back to `undefined`
     * otherwise. Survives reconnects that skip the handshake — the field is
     * set on the original join and never cleared.
     *
     * Typed as `new () => any` (not `Schema`) on purpose — pinning to this
     * SDK's Schema type would clash with user instances coming from a
     * different copy of `@colyseus/schema` under multi-version installs.
     * @internal
     */
    #inputCtorFromReflection?: new () => any;

    /**
     * `true` when the server's handshake advertised render-time lag comp (the
     * `INPUT_OPTIONS` section, `InputFlags.RENDER_TIME`). The input handle then
     * auto-stamps each reliable input with a server-clock render timestamp.
     * @internal
     */
    #inputRenderTime = false;

    constructor(name: string, rootSchema?: SchemaConstructor<State>) {
        this.name = name;

        this.packr = new Packr();
        this.sharedBuffer = new Uint8Array(8192);

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
            // the in-flight requests can't be answered on a closed socket
            this.#rejectAllPending("connection closed before a response was received.");

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
                this.handleReconnection(e.code, e.reason);

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
                    this.sharedBuffer[0] = Protocol.LEAVE_ROOM;
                    this.connection.send(this.sharedBuffer.subarray(0, 1));

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
        this.sharedBuffer[0] = Protocol.PING;
        this.connection.send(this.sharedBuffer.subarray(0, 1));
    }

    public send<MessageType extends keyof ExtractRoomMessages<NormalizeRoomType<T>>>(
        messageType: MessageType,
        payload?: ExtractMessageType<ExtractRoomMessages<NormalizeRoomType<T>>[MessageType]>
    ): void
    // Request overload: passing a callback turns this into a request/response —
    // the callback receives the value the server handler returns (or an Error).
    public send<MessageType extends keyof ExtractRoomMessages<NormalizeRoomType<T>>>(
        messageType: MessageType,
        payload: ExtractMessageType<ExtractRoomMessages<NormalizeRoomType<T>>[MessageType]>,
        callback: (response: ExtractResponseType<ExtractRoomMessages<NormalizeRoomType<T>>[MessageType]>, error?: Error) => void
    ): void
    // Fallback overload: only available when no typed messages are defined
    public send<Payload = any>(
        messageType: [keyof ExtractRoomMessages<NormalizeRoomType<T>>] extends [never] ? (string | number) : never,
        payload?: Payload
    ): void
    // Fallback request overload
    public send<Payload = any, Response = any>(
        messageType: [keyof ExtractRoomMessages<NormalizeRoomType<T>>] extends [never] ? (string | number) : never,
        payload: Payload,
        callback: (response: Response, error?: Error) => void
    ): void
    public send(messageType: string | number, payload?: any, callback?: (response: any, error?: Error) => void): void {
        // Request/response form: defer to `request()` and adapt to a
        // (response, error) callback.
        if (callback !== undefined) {
            this.#request(messageType, payload, this.requestTimeout).then(
                (response) => callback(response, undefined),
                (error) => callback(undefined, error),
            );
            return;
        }

        const it: Iterator = { offset: 1 };
        this.sharedBuffer[0] = Protocol.ROOM_DATA;

        if (typeof(messageType) === "string") {
            encode.string(this.sharedBuffer, messageType, it);

        } else {
            encode.number(this.sharedBuffer, messageType, it);
        }
        const headerLength = it.offset;

        let data: Uint8Array;
        if (payload !== undefined) {
            // Reserve `headerLength` writable bytes at the front of msgpackr's
            // output and prepend the protocol header into them.
            data = this.packr.pack(payload, RESERVE_START_SPACE | headerLength);
            data.set(this.sharedBuffer.subarray(0, headerLength), 0);
        } else {
            data = this.sharedBuffer.subarray(0, headerLength);
        }

        // If connection is not open, buffer the message
        if (!this.connection.isOpen) {
            enqueueMessage(this, new Uint8Array(data));
        } else {
            this.connection.send(data);
        }
    }

    /**
     * Send a message and await the server's reply. The server answers by
     * returning a value from its matching `onMessage(type, ...)` handler.
     *
     * Rejects if the handler throws, if no handler is registered, if the
     * connection closes first, or if no reply arrives within `timeout`
     * (defaults to {@link Room.requestTimeout}).
     *
     * @example
     * ```typescript
     * const profile = await room.request("get-profile", { id: 42 });
     * ```
     */
    public request<MessageType extends keyof ExtractRoomMessages<NormalizeRoomType<T>>>(
        messageType: MessageType,
        payload?: ExtractMessageType<ExtractRoomMessages<NormalizeRoomType<T>>[MessageType]>,
        options?: { timeout?: number }
    ): Promise<ExtractResponseType<ExtractRoomMessages<NormalizeRoomType<T>>[MessageType]>>
    public request<Payload = any, Response = any>(
        messageType: [keyof ExtractRoomMessages<NormalizeRoomType<T>>] extends [never] ? (string | number) : never,
        payload?: Payload,
        options?: { timeout?: number }
    ): Promise<Response>
    public request(messageType: string | number, payload?: any, options?: { timeout?: number }): Promise<any> {
        return this.#request(messageType, payload, options?.timeout ?? this.requestTimeout);
    }

    #request(messageType: string | number, payload: any, timeoutMs: number): Promise<any> {
        return new Promise((resolve, reject) => {
            if (!this.connection.isOpen) {
                reject(new Error(`cannot send request "${messageType}": connection is not open.`));
                return;
            }

            const requestId = this.#nextRequestId;
            this.#nextRequestId = (this.#nextRequestId + 1) >>> 0; // keep within uint32

            const it: Iterator = { offset: 1 };
            this.sharedBuffer[0] = Protocol.ROOM_REQUEST;
            encode.number(this.sharedBuffer, requestId, it);

            if (typeof(messageType) === "string") {
                encode.string(this.sharedBuffer, messageType, it);
            } else {
                encode.number(this.sharedBuffer, messageType, it);
            }
            const headerLength = it.offset;

            let data: Uint8Array;
            if (payload !== undefined) {
                data = this.packr.pack(payload, RESERVE_START_SPACE | headerLength);
                data.set(this.sharedBuffer.subarray(0, headerLength), 0);
            } else {
                data = this.sharedBuffer.subarray(0, headerLength);
            }

            const timer = setTimeout(() => {
                this.#pendingRequests.delete(requestId);
                reject(new Error(`request "${messageType}" timed out after ${timeoutMs}ms.`));
            }, timeoutMs);

            this.#pendingRequests.set(requestId, { resolve, reject, timer });
            this.connection.send(data);
        });
    }

    #rejectAllPending(reason: string) {
        if (this.#pendingRequests.size === 0) { return; }
        const error = new Error(reason);
        for (const pending of this.#pendingRequests.values()) {
            clearTimeout(pending.timer);
            pending.reject(error);
        }
        this.#pendingRequests.clear();
    }

    public sendUnreliable<T = any>(type: string | number, message?: T): void {
        // If connection is not open, skip
        if (!this.connection.isOpen) { return; }

        const it: Iterator = { offset: 1 };
        this.sharedBuffer[0] = Protocol.ROOM_DATA;

        if (typeof(type) === "string") {
            encode.string(this.sharedBuffer, type, it);

        } else {
            encode.number(this.sharedBuffer, type, it);
        }
        const headerLength = it.offset;

        let data: Uint8Array;
        if (message !== undefined) {
            data = this.packr.pack(message, RESERVE_START_SPACE | headerLength);
            data.set(this.sharedBuffer.subarray(0, headerLength), 0);
        } else {
            data = this.sharedBuffer.subarray(0, headerLength);
        }

        this.connection.sendUnreliable(data);
    }

    public sendBytes(type: string | number, bytes: Uint8Array) {
        const it: Iterator = { offset: 1 };
        this.sharedBuffer[0] = Protocol.ROOM_DATA_BYTES;

        if (typeof(type) === "string") {
            encode.string(this.sharedBuffer, type, it);

        } else {
            encode.number(this.sharedBuffer, type, it);
        }
        const headerLength = it.offset;

        // grow the scratch buffer if needed, preserving the header bytes
        if (headerLength + bytes.byteLength > this.sharedBuffer.byteLength) {
            const newBuffer = new Uint8Array(headerLength + bytes.byteLength);
            newBuffer.set(this.sharedBuffer.subarray(0, headerLength));
            this.sharedBuffer = newBuffer;
        }

        this.sharedBuffer.set(bytes, headerLength);

        // If connection is not open, buffer the message
        if (!this.connection.isOpen) {
            enqueueMessage(this, this.sharedBuffer.subarray(0, headerLength + bytes.byteLength));
        } else {
            this.connection.send(this.sharedBuffer.subarray(0, headerLength + bytes.byteLength));
        }

    }

    /**
     * Get the per-room input handle. Lazily created on first call and cached;
     * subsequent calls return the same handle (options on later calls are
     * ignored).
     *
     * Schema discovery, in order:
     * 1. `options.type` — explicit constructor (overrides everything).
     * 2. Server-sent reflection from the JOIN handshake — populated when the
     *    server room called `defineInput()`. The synthesized class has the
     *    same fields as the server's input schema; `instanceof YourInput`
     *    won't pass on it.
     *
     * Throws if neither source has produced a constructor.
     *
     * For rollback netcode, prefer `{ mode: "unreliable", delta: true,
     * historySize: 4 }`: tiny per-tick payloads, redundancy across drops,
     * idempotent under reordering.
     *
     * @example
     * ```typescript
     * const conn = await client.joinOrCreate<typeof FpsRoom>("fps");
     * const input = conn.input({ mode: "unreliable" });   // type from server
     * // each simulation tick:
     * input.data.seq++;
     * input.data.vx = vx;
     * input.data.vy = vy;
     * input.send();
     * ```
     */
    public input<
        I = ([InferInput<T>] extends [never] ? any : InferInput<T>),
    >(options?: InputOptions<I>): InputHandle<I> {
        if (this.#inputHandle) {
            return this.#inputHandle as InputHandle<I>;
        }

        const Ctor = (options?.type ?? this.#inputCtorFromReflection) as (new () => I) | undefined;
        if (!Ctor) {
            throw new Error(
                "conn.input(): no input schema available. The server room must call " +
                "`defineInput(YourInput)`, or you can pass `{ type: YourInput }` explicitly."
            );
        }

        const instance = new Ctor();
        const encoder = new InputEncoder(instance as any, options);
        // The handle owns the input round-trip (send counter + send-time table
        // for RTT, and the server-acked count). The TIMED decode feeds it the
        // server ack; it produces RTT samples for the clock. See onMessage.
        // `renderTime` is server-driven (the INPUT_OPTIONS handshake flag);
        // `renderDelay` lets the app subtract its interpolation buffer.
        this.#inputHandle = new InputHandleImpl(this, instance, encoder, {
            renderTime: this.#inputRenderTime,
            renderDelay: options?.renderDelay,
        });
        return this.#inputHandle as InputHandle<I>;
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
        // Strip modifier bits (e.g. ProtocolModifier.TIMED). Consume any
        // modifier-attached prefix bytes here so the dispatch tree below
        // stays modifier-agnostic.
        const rawByte = buffer[0];
        const code = rawByte & PROTOCOL_CODE_MASK;
        if (rawByte & ProtocolModifier.TIMED) {
            // [uint32 sNow][uint32 inputSeq]  — sNow = ms since room start
            // (clock.elapsedTime); inputSeq = last PROCESSED input.
            //
            // Routing: the INPUT ack goes to the input handle (it owns the
            // round-trip — what you sent, what's acked); it returns an RTT
            // sample which, with sNow, feeds the time-only clock. `decode.*`
            // advance `it.offset`; read in declared byte order.
            const sNow = decode.uint32(buffer as Buffer, it);
            const inputSeq = decode.uint32(buffer as Buffer, it);
            const rttSample = this.#inputHandle ? this.#inputHandle.ackInput(inputSeq) : -1;
            this.clock.sample(sNow, rttSample);
        }

        if (code === Protocol.JOIN_ROOM) {
            const reconnectionToken = decode.utf8Read(buffer as Buffer, it, buffer[it.offset++]);
            this.serializerId = decode.utf8Read(buffer as Buffer, it, buffer[it.offset++]);

            // Instantiate serializer if not locally available.
            if (!this.serializer) {
                const serializer = getSerializer(this.serializerId);
                this.serializer = new serializer();
            }

            // State reflection is length-prefixed (varint). The schema decoder
            // runs `while (offset < bytes.byteLength)` so without a boundary
            // it would read past the state reflection into the trailing
            // tagged-section bytes — see Protocol.ts for the wire layout.
            const stateReflectionLen = decode.number(buffer as Buffer, it);
            if (stateReflectionLen > 0 && this.serializer.handshake) {
                const stateReflectionEnd = it.offset + stateReflectionLen;
                this.serializer.handshake(buffer.subarray(0, stateReflectionEnd), it);
                it.offset = stateReflectionEnd;
            }

            // Parse trailing tagged sections (forward-compatible: unknown tags
            // are skipped via length). See HandshakeSection in shared-types.
            while (it.offset < buffer.byteLength) {
                const tag = buffer[it.offset++];
                const sectionLen = decode.number(buffer as Buffer, it);
                const sectionEnd = it.offset + sectionLen;

                if (tag === HandshakeSection.INPUT_REFLECTION) {
                    const inputDecoder = Reflection.decode(buffer.subarray(0, sectionEnd) as any, it);
                    // Install schema-builder field descriptors on the
                    // reconstructed class so `InputEncoder` can read its
                    // `$values` and emit non-empty packets.
                    Reflection.makeEncodable(inputDecoder.state.constructor as any);
                    this.#inputCtorFromReflection = inputDecoder.state.constructor as new () => any;

                    // INPUT_REFLECTION is the signal that the server called
                    // `defineInput()` and will emit TIMED-prefixed state
                    // messages. Swap the default stub clock for a real
                    // {@link RoomClock} so RTT/offset estimation kicks in.
                    // Skip if the user already replaced `room.clock` with
                    // their own (e.g. via `room.clock = new MyClock()` after
                    // `await joinOrCreate(...)`).
                    if (this.clock === NULL_CLOCK) this.clock = new RoomClock();

                } else if (tag === HandshakeSection.INPUT_OPTIONS) {
                    // Input feature flags the client must mirror. Currently only
                    // RENDER_TIME (auto-stamp reliable inputs with a server-clock
                    // render timestamp for lag-compensated hit registration).
                    const flags = buffer[it.offset];
                    this.#inputRenderTime = (flags & InputFlags.RENDER_TIME) !== 0;
                }

                it.offset = sectionEnd;
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

            // Acknowledge JOIN_ROOM.
            this.sharedBuffer[0] = Protocol.JOIN_ROOM;
            this.connection.send(this.sharedBuffer.subarray(0, 1));

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

        } else if (code === Protocol.ROOM_RESPONSE) {
            // reply to a pending `request()` / `send(..., callback)`
            const requestId = decode.number(buffer as Buffer, it);
            const status = buffer[it.offset++];

            const pending = this.#pendingRequests.get(requestId);
            // already settled (e.g. timed out) or unknown id — ignore
            if (pending !== undefined) {
                this.#pendingRequests.delete(requestId);
                clearTimeout(pending.timer);

                const payload = (buffer.byteLength > it.offset)
                    ? unpack(buffer as Buffer, { start: it.offset })
                    : undefined;

                if (status === ResponseStatus.OK) {
                    pending.resolve(payload);
                } else {
                    // payload carries { name, message, code } from the server
                    const error: any = new Error(payload?.message ?? "request failed");
                    if (payload?.name) { error.name = payload.name; }
                    if (payload?.code !== undefined) { error.code = payload.code; }
                    pending.reject(error);
                }
            }

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

    private handleReconnection(code: number, reason?: string) {
        if (!this.reconnection.enabled) {
            this.onLeave.invoke(code, reason);
            return;
        }

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



import { Connection } from './Connection';
import { Protocol } from './Protocol';
import { getSerializer, Serializer } from './serializer/Serializer';
import { type Room as ServerRoom } from "@colyseus/core"

// The unused imports here are important for better `.d.ts` file generation
// (Later merged with `dts-bundle-generator`)
import { createNanoEvents } from './core/nanoevents';
import { createSignal } from './core/signal';

import { decode, encode, Iterator } from '@colyseus/schema';
import { SchemaConstructor, SchemaSerializer } from './serializer/SchemaSerializer';
import { CloseCode } from './errors/Errors';

import { Packr, unpack } from '@colyseus/msgpackr';

export interface RoomAvailable<Metadata = any> {
    name: string;
    roomId: string;
    clients: number;
    maxClients: number;
    metadata?: Metadata;
}

export class Room<
    RoomType extends typeof ServerRoom = any,
    State = RoomType['prototype']['state'],
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
    protected onJoin = createSignal();

    public serializerId: string;
    public serializer: Serializer<State>;

    protected hasJoined: boolean = false;

    // TODO: remove me on 1.0.0
    protected rootSchema: SchemaConstructor<State>;

    protected onMessageHandlers = createNanoEvents();

    protected packr: Packr;

    constructor(name: string, rootSchema?: SchemaConstructor<State>) {
        this.roomId = null;
        this.name = name;

        this.packr = new Packr();

        // msgpackr workaround: force buffer to be created.
        this.packr.encode(undefined);

        if (rootSchema) {
            this.serializer = new (getSerializer("schema"));
            this.rootSchema = rootSchema;
            (this.serializer as SchemaSerializer).state = new rootSchema();
        }

        this.onError((code, message) => console.warn?.(`colyseus.js - onError => (${code}) ${message}`));
        this.onLeave(() => this.removeAllListeners());
    }

    public connect(
        endpoint: string,
        devModeCloseCallback?: () => void,
        room: Room = this, // when reconnecting on devMode, re-use previous room intance for handling events.
        options?: any,
        headers?: any,
    ) {
        const connection = new Connection(options.protocol);
        room.connection = connection;

        connection.events.onmessage = Room.prototype.onMessageCallback.bind(room);
        connection.events.onclose = function (e: CloseEvent) {
            if (!room.hasJoined) {
                console.warn?.(`Room connection was closed unexpectedly (${e.code}): ${e.reason}`);
                room.onError.invoke(e.code, e.reason);
                return;
            }
            if (e.code === CloseCode.DEVMODE_RESTART && devModeCloseCallback) {
                devModeCloseCallback();
            } else {
                room.onLeave.invoke(e.code, e.reason);
                room.destroy();
            }
        };
        connection.events.onerror = function (e: CloseEvent) {
            console.warn?.(`Room, onError (${e.code}): ${e.reason}`);
            room.onError.invoke(e.code, e.reason);
        };

        // FIXME: refactor this.
        if (options.protocol === "h3") {
            const url = new URL(endpoint);
            connection.connect(url.origin, options);

        } else {
            connection.connect(endpoint, headers);
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

    public onMessage<MessageType extends keyof RoomType['prototype']['~client']['~messages']>(
        message: MessageType,
        callback: (payload: RoomType['prototype']['~client']['~messages'][MessageType]) => void
    )
    public onMessage<T = any>(type: "*", callback: (messageType: string | number, payload: T) => void)
    public onMessage<T = any>(type: string | number, callback: (payload: T) => void)
    public onMessage(type: '*' | string | number, callback: (...args: any[]) => void) {
        return this.onMessageHandlers.on(this.getMessageHandlerKey(type), callback);
    }

    public send<MessageType extends keyof RoomType['prototype']['messages']>(
        messageType: MessageType,
        payload?: Parameters<RoomType['prototype']['messages'][MessageType]>[1]
    )
    public send<T = any>(messageType: string | number, payload?: T): void {
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

        this.connection.send(data);
    }

    public sendUnreliable<T = any>(type: string | number, message?: T): void {
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
        this.connection.send(this.packr.buffer.subarray(0, it.offset + bytes.byteLength));
    }

    public get state (): State {
        return this.serializer.getState();
    }

    public removeAllListeners() {
        this.onJoin.clear();
        this.onStateChange.clear();
        this.onError.clear();
        this.onLeave.clear();
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

            if (buffer.byteLength > it.offset && this.serializer.handshake) {
                this.serializer.handshake(buffer, it);
            }

            this.reconnectionToken = `${this.roomId}:${reconnectionToken}`;

            this.hasJoined = true;
            this.onJoin.invoke();

            // acknowledge successfull JOIN_ROOM
            this.packr.buffer[0] = Protocol.JOIN_ROOM;
            this.connection.send(this.packr.buffer.subarray(0, 1));

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
        }
    }

    private dispatchMessage(type: string | number, message: any) {
        const messageType = this.getMessageHandlerKey(type);

        if (this.onMessageHandlers.events[messageType]) {
            this.onMessageHandlers.emit(messageType, message);

        } else if (this.onMessageHandlers.events['*']) {
            this.onMessageHandlers.emit('*', type, message);

        } else {
            console.warn?.(`colyseus.js: onMessage() not registered for type '${type}'.`);
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

}

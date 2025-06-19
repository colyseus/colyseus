import type { Iterator } from "@colyseus/schema";

export type BufferLike = number[] | Uint8Array | Buffer;

export interface Serializer<State> {
    setState(data: BufferLike, it?: Iterator): void;
    getState(): State;

    patch(data: BufferLike, it?: Iterator): void;
    teardown(): void;

    handshake?(bytes: BufferLike, it?: any): void;
}

const serializers: { [id: string]: any } = {};

export function registerSerializer (id: string, serializer: any) {
    serializers[id] = serializer;
}

export function getSerializer (id: string) {
    const serializer = serializers[id];
    if (!serializer) { throw new Error("missing serializer: " + id); }
    return serializer;
}
import type { Iterator } from "@colyseus/schema";

export interface Serializer<State> {
    setState(data: Uint8Array, it?: Iterator): void;
    getState(): State;

    patch(data: Uint8Array, it?: Iterator): void;
    teardown(): void;

    handshake?(bytes: Uint8Array, it?: any): void;
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
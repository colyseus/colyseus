import { Client } from '..';
import { Serializer } from './Serializer';
import { Schema } from '@colyseus/schema';
export declare class SchemaSerializer<T> implements Serializer<T> {
    id: string;
    private state;
    private useFilters;
    private handshakeCache;
    reset(newState: T & Schema): void;
    getFullState(client?: Client): number[];
    applyPatches(clients: Client[]): boolean;
    handshake(): number[];
}

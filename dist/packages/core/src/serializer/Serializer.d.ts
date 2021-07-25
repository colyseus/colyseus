import { Client } from '..';
export interface Serializer<T> {
    id: string;
    reset(data: any): void;
    getFullState(client?: Client): any;
    applyPatches(clients: Client[], state: T): boolean;
    handshake?(): number[];
}

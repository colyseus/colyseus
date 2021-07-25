import { Client } from '../Transport';
import { Serializer } from './Serializer';
export declare class NoneSerializer<T = any> implements Serializer<T> {
    id: string;
    reset(data: any): void;
    getFullState(client?: Client): any;
    applyPatches(clients: Client[], state: T): boolean;
}

import { MapSchema, Schema } from '@colyseus/schema';
import { Room } from '../Room';
import { Client } from '../Transport';
declare class Player extends Schema {
    connected: boolean;
    name: boolean;
    sessionId: string;
}
declare class State extends Schema {
    players: MapSchema<Player>;
}
/**
 * client.joinOrCreate("relayroom", {
 *   maxClients: 10,
 *   allowReconnectionTime: 20
 * });
 */
export declare class RelayRoom extends Room<State> {
    allowReconnectionTime: number;
    onCreate(options: Partial<{
        maxClients: number;
        allowReconnectionTime: number;
        metadata: any;
    }>): void;
    onJoin(client: Client, options?: any): void;
    onLeave(client: Client, consented: boolean): Promise<void>;
}
export {};

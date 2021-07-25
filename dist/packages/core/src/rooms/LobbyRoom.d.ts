import { RoomListingData } from '../matchmaker/driver';
import { Room } from '../Room';
import { Client } from '../Transport';
export interface FilterInput {
    name?: string;
    metadata?: any;
}
export interface LobbyOptions {
    filter?: FilterInput;
}
export declare class LobbyRoom extends Room {
    rooms: RoomListingData[];
    unsubscribeLobby: () => void;
    clientOptions: {
        [sessionId: string]: LobbyOptions;
    };
    onCreate(options: any): Promise<void>;
    onJoin(client: Client, options: LobbyOptions): void;
    onLeave(client: Client): void;
    onDispose(): void;
    protected filterItemsForClient(options: LobbyOptions): RoomListingData<any>[];
    protected filterItemForClient(room: RoomListingData, filter?: LobbyOptions['filter']): boolean;
}

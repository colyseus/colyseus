import { RoomListingData } from './interfaces';
export declare class RoomCache implements RoomListingData {
    clients: number;
    locked: boolean;
    private: boolean;
    maxClients: number;
    metadata: any;
    name: string;
    processId: string;
    roomId: string;
    createdAt: Date;
    unlisted: boolean;
    private $rooms;
    constructor(initialValues: any, rooms: RoomCache[]);
    toJSON(): {
        clients: number;
        createdAt: Date;
        maxClients: number;
        metadata: any;
        name: string;
        processId: string;
        roomId: string;
    };
    save(): void;
    updateOne(operations: any): void;
    remove(): void;
}

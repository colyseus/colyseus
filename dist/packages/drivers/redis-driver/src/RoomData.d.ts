import { RoomListingData } from '@colyseus/core';
import { RedisClient } from 'redis';
export declare class RoomData implements RoomListingData {
    #private;
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
    cachekey: string;
    constructor(initialValues: any, client: RedisClient, _cachekey: string);
    toJSON(): {
        clients: number;
        createdAt: Date;
        maxClients: number;
        metadata: any;
        name: string;
        processId: string;
        roomId: string;
    };
    save(): Promise<void>;
    updateOne(operations: any): Promise<void>;
    remove(): Promise<unknown>;
    private hset;
    private hdel;
}

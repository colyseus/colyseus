import { ClientOpts } from 'redis';
import { IRoomListingData, MatchMakerDriver, QueryHelpers, RoomListingData } from '@colyseus/core';
import { RoomData } from './RoomData';
export declare class RedisDriver implements MatchMakerDriver {
    private readonly _client;
    private readonly hgetall;
    _cachekey: string;
    constructor(options?: ClientOpts, key?: string);
    createInstance(initialValues?: any): RoomData;
    find(conditions: any): Promise<RoomData[]>;
    findOne(conditions: Partial<IRoomListingData>): QueryHelpers<RoomListingData>;
    getRooms(): Promise<RoomData[]>;
    clear(): void;
    shutdown(): void;
}

import { IRoomListingData, SortOptions, RoomListingData, QueryHelpers, MatchMakerDriver } from "./interfaces";
export { IRoomListingData, SortOptions, RoomListingData, QueryHelpers, MatchMakerDriver };
import { RoomCache } from './RoomData';
export declare class LocalDriver implements MatchMakerDriver {
    rooms: RoomCache[];
    createInstance(initialValues?: any): RoomCache;
    find(conditions: Partial<IRoomListingData>): RoomCache[];
    findOne(conditions: Partial<IRoomListingData>): QueryHelpers<RoomListingData<any>>;
    clear(): void;
    shutdown(): void;
}

import { RoomListingData } from "@colyseus/core";
export declare function setPrometheusCounters(global: any, totalRooms: any, lockedRooms: any): void;
export declare function updateLockRoomStatsCount(increment: boolean): Promise<void>;
export declare function updateTotalRoomStatsCount(increment: boolean): Promise<void>;
export declare function incrementClientStatsCount(listing: RoomListingData): Promise<void>;
export declare function decrementClientCount(listing: RoomListingData, isDisconnecting?: boolean): Promise<void>;

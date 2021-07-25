import { RegisteredHandler } from './matchmaker/RegisteredHandler';
import { Room } from './Room';
import { Presence } from './presence/Presence';
import { IRoomListingData, MatchMakerDriver, RoomListingData } from './matchmaker/driver';
import * as controller from './matchmaker/controller';
import { Type } from './types';
export { MatchMakerDriver, controller };
export declare type ClientOptions = any;
export interface SeatReservation {
    sessionId: string;
    room: RoomListingData;
}
export declare let processId: string;
export declare let presence: Presence;
export declare let driver: MatchMakerDriver;
export declare function setup(_presence?: Presence, _driver?: MatchMakerDriver, _processId?: string): void;
/**
 * Join or create into a room and return seat reservation
 */
export declare function joinOrCreate(roomName: string, clientOptions?: ClientOptions): Promise<SeatReservation>;
/**
 * Create a room and return seat reservation
 */
export declare function create(roomName: string, clientOptions?: ClientOptions): Promise<{
    room: RoomListingData<any>;
    sessionId: string;
}>;
/**
 * Join a room and return seat reservation
 */
export declare function join(roomName: string, clientOptions?: ClientOptions): Promise<SeatReservation>;
/**
 * Join a room by id and return seat reservation
 */
export declare function joinById(roomId: string, clientOptions?: ClientOptions): Promise<{
    room: RoomListingData<any>;
    sessionId: any;
}>;
/**
 * Perform a query for all cached rooms
 */
export declare function query(conditions?: Partial<IRoomListingData>): Promise<RoomListingData<any>[]>;
/**
 * Find for a public and unlocked room available
 */
export declare function findOneRoomAvailable(roomName: string, clientOptions: ClientOptions): Promise<RoomListingData>;
/**
 * Call a method or return a property on a remote room.
 */
export declare function remoteRoomCall<R = any>(roomId: string, method: string, args?: any[], rejectionTimeout?: number): Promise<R>;
export declare function defineRoomType<T extends Type<Room>>(name: string, klass: T, defaultOptions?: Parameters<NonNullable<InstanceType<T>['onCreate']>>[0]): RegisteredHandler;
export declare function removeRoomType(name: string): void;
export declare function hasHandler(name: string): boolean;
/**
 * Create a room
 */
export declare function createRoom(roomName: string, clientOptions: ClientOptions): Promise<RoomListingData>;
export declare function getRoomById(roomId: string): Room<any, any>;
/**
 * Disconnects every client on every room in the current process.
 */
export declare function disconnectAll(): Promise<any>[];
export declare function gracefullyShutdown(): Promise<any>;
/**
 * Reserve a seat for a client in a room
 */
export declare function reserveSeatFor(room: RoomListingData, options: any): Promise<{
    room: RoomListingData<any>;
    sessionId: string;
}>;

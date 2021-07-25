/**
 * Matchmaking controller
 * (for interoperability between different http frameworks, e.g. express, uWebSockets.js, etc)
 */
export declare function getAvailableRooms(roomName: string): Promise<import("./driver").RoomListingData<any>[]>;
export declare function invokeMethod(method: string, roomName: string, clientOptions?: any): Promise<any>;

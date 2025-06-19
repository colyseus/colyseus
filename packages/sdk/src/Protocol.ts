import { RoomAvailable } from "./Room";

export interface SeatReservation {
    room: RoomAvailable;
    sessionId: string;
    reconnectionToken?: string;
    devMode?: boolean;
    protocol?: string;
}

// Use codes between 0~127 for lesser throughput (1 byte)
export enum Protocol {
    // Room-related (10~19)
    HANDSHAKE = 9,
    JOIN_ROOM = 10,
    ERROR = 11,
    LEAVE_ROOM = 12,
    ROOM_DATA = 13,
    ROOM_STATE = 14,
    ROOM_STATE_PATCH = 15,
    ROOM_DATA_SCHEMA = 16,
    ROOM_DATA_BYTES = 17,
}

export enum ErrorCode {
    MATCHMAKE_NO_HANDLER = 4210,
    MATCHMAKE_INVALID_CRITERIA = 4211,
    MATCHMAKE_INVALID_ROOM_ID = 4212,
    MATCHMAKE_UNHANDLED = 4213,
    MATCHMAKE_EXPIRED = 4214,

    AUTH_FAILED = 4215,
    APPLICATION_ERROR = 4216,
}

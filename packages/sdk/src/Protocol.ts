import { RoomAvailable } from "./Room.ts";

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
    PING = 18,
}

export enum ErrorCode {
    MATCHMAKE_NO_HANDLER = 520,
    MATCHMAKE_INVALID_CRITERIA = 521,
    MATCHMAKE_INVALID_ROOM_ID = 522,
    MATCHMAKE_UNHANDLED = 523,
    MATCHMAKE_EXPIRED = 524,

    AUTH_FAILED = 525,
    APPLICATION_ERROR = 526,
}

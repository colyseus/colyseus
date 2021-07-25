/// <reference types="node" />
import { Schema } from '@colyseus/schema';
export declare enum Protocol {
    JOIN_ROOM = 10,
    ERROR = 11,
    LEAVE_ROOM = 12,
    ROOM_DATA = 13,
    ROOM_STATE = 14,
    ROOM_STATE_PATCH = 15,
    ROOM_DATA_SCHEMA = 16,
    WS_CLOSE_NORMAL = 1000,
    WS_CLOSE_CONSENTED = 4000,
    WS_CLOSE_WITH_ERROR = 4002,
    WS_SERVER_DISCONNECT = 4201,
    WS_TOO_MANY_CLIENTS = 4202
}
export declare enum ErrorCode {
    MATCHMAKE_NO_HANDLER = 4210,
    MATCHMAKE_INVALID_CRITERIA = 4211,
    MATCHMAKE_INVALID_ROOM_ID = 4212,
    MATCHMAKE_UNHANDLED = 4213,
    MATCHMAKE_EXPIRED = 4214,
    AUTH_FAILED = 4215,
    APPLICATION_ERROR = 4216
}
export declare enum IpcProtocol {
    SUCCESS = 0,
    ERROR = 1,
    TIMEOUT = 2
}
export declare const getMessageBytes: {
    10: (serializerId: string, handshake?: number[]) => Buffer;
    11: (code: number, message?: string) => Protocol[];
    14: (bytes: number[]) => number[];
    16: (message: Schema) => number[];
    13: (type: string | number, message?: any) => Uint8Array;
};
export declare function utf8Write(buff: Buffer, offset: number, str?: string): void;
export declare function utf8Length(str?: string): number;

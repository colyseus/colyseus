/// <reference types="node" />
import EventEmitter from 'events';
import uWebSockets from 'uWebSockets.js';
import { Client, ClientState, ISendOptions } from '@colyseus/core';
export declare class uWebSocketWrapper extends EventEmitter {
    ws: uWebSockets.WebSocket;
    constructor(ws: uWebSockets.WebSocket);
}
export declare enum ReadyState {
    CONNECTING = 0,
    OPEN = 1,
    CLOSING = 2,
    CLOSED = 3
}
export declare class uWebSocketClient implements Client {
    id: string;
    ref: uWebSocketWrapper;
    sessionId: string;
    state: ClientState;
    _enqueuedMessages: any[];
    _afterNextPatchQueue: any;
    readyState: number;
    constructor(id: string, ref: uWebSocketWrapper);
    send(messageOrType: any, messageOrOptions?: any | ISendOptions, options?: ISendOptions): void;
    enqueueRaw(data: ArrayLike<number>, options?: ISendOptions): void;
    raw(data: ArrayLike<number>, options?: ISendOptions, cb?: (err?: Error) => void): void;
    error(code: number, message?: string, cb?: (err?: Error) => void): void;
    leave(code?: number, data?: string): void;
    close(code?: number, data?: string): void;
    toJSON(): {
        sessionId: string;
        readyState: number;
    };
}

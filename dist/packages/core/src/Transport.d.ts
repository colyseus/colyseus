/// <reference types="node" />
import * as http from 'http';
import * as https from 'https';
import * as net from 'net';
import { Schema } from '@colyseus/schema';
import { EventEmitter } from 'events';
export declare abstract class Transport {
    server?: net.Server | http.Server | https.Server;
    abstract listen(port?: number, hostname?: string, backlog?: number, listeningListener?: Function): this;
    abstract shutdown(): void;
    abstract simulateLatency(milliseconds: number): void;
}
export interface ISendOptions {
    afterNextPatch?: boolean;
}
export declare enum ClientState {
    JOINING = 0,
    JOINED = 1,
    RECONNECTED = 2,
    LEAVING = 3
}
export interface Client {
    readyState: number;
    id: string;
    sessionId: string;
    state: ClientState;
    ref: EventEmitter;
    upgradeReq?: http.IncomingMessage;
    /**
     * User-defined data can be attached to the Client instance through this variable.
     */
    userData?: any;
    /**
     * auth data provided by your `onAuth`
     */
    auth?: any;
    pingCount?: number;
    _enqueuedMessages?: any[];
    _afterNextPatchQueue: Array<[string | Client, IArguments]>;
    raw(data: ArrayLike<number>, options?: ISendOptions): void;
    enqueueRaw(data: ArrayLike<number>, options?: ISendOptions): void;
    send(type: string | number, message?: any, options?: ISendOptions): void;
    send(message: Schema, options?: ISendOptions): void;
    error(code: number, message?: string): void;
    leave(code?: number, data?: string): void;
    close(code?: number, data?: string): void;
}

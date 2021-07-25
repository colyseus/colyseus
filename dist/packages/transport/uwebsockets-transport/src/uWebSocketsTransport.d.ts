import uWebSockets from 'uWebSockets.js';
import { Transport } from '@colyseus/core';
import { uWebSocketWrapper } from './uWebSocketClient';
export declare type TransportOptions = Omit<uWebSockets.WebSocketBehavior, "upgrade" | "open" | "pong" | "close" | "message">;
declare type RawWebSocketClient = uWebSockets.WebSocket & {
    headers: {
        [key: string]: string;
    };
    connection: {
        remoteAddress: string;
    };
};
export declare class uWebSocketsTransport extends Transport {
    app: uWebSockets.TemplatedApp;
    protected clients: RawWebSocketClient[];
    protected clientWrappers: WeakMap<RawWebSocketClient, uWebSocketWrapper>;
    private _listeningSocket;
    constructor(options?: TransportOptions, appOptions?: uWebSockets.AppOptions);
    listen(port: number, hostname?: string, backlog?: number, listeningListener?: () => void): this;
    shutdown(): void;
    simulateLatency(milliseconds: number): void;
    protected onConnection(rawClient: RawWebSocketClient): Promise<void>;
    protected registerMatchMakeRequest(): void;
    private readJson;
}
export {};

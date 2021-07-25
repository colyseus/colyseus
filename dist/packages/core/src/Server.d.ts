/// <reference types="node" />
import http, { IncomingMessage, ServerResponse } from 'http';
import * as matchMaker from './MatchMaker';
import { RegisteredHandler } from './matchmaker/RegisteredHandler';
import { Presence } from './presence/Presence';
import { Room } from './Room';
import { Type } from './types';
import { Transport } from './Transport';
export declare type ServerOptions = {
    presence?: Presence;
    driver?: matchMaker.MatchMakerDriver;
    transport?: Transport;
    gracefullyShutdown?: boolean;
    /**
     * Options below are now part of WebSocketTransport (@colyseus/ws-transport)
     * TODO: remove me on 0.15.0
     */
    /** @deprecated */
    pingInterval?: number;
    /** @deprecated */
    pingMaxRetries?: number;
    /** @deprecated */
    verifyClient?: any;
    /** @deprecated */
    server?: http.Server;
};
export declare class Server {
    transport: Transport;
    protected presence: Presence;
    protected port: number;
    protected driver: matchMaker.MatchMakerDriver;
    protected processId: string;
    private matchmakeRoute;
    private allowedRoomNameChars;
    constructor(options?: ServerOptions);
    attach(options: ServerOptions): void;
    /**
     * Bind the server into the port specified.
     *
     * @param port
     * @param hostname
     * @param backlog
     * @param listeningListener
     */
    listen(port: number, hostname?: string, backlog?: number, listeningListener?: Function): Promise<void>;
    registerProcessForDiscovery(): void;
    /**
     * Define a new type of room for matchmaking.
     *
     * @param name public room identifier for match-making.
     * @param handler Room class definition
     * @param defaultOptions default options for `onCreate`
     */
    define<T extends Type<Room>>(name: string, handler: T, defaultOptions?: Parameters<NonNullable<InstanceType<T>['onCreate']>>[0]): RegisteredHandler;
    gracefullyShutdown(exit?: boolean, err?: Error): Promise<void>;
    /**
     * Add simulated latency between client and server.
     * @param milliseconds round trip latency in milliseconds.
     */
    simulateLatency(milliseconds: number): void;
    /**
     * Register a callback that is going to be executed before the server shuts down.
     * @param callback
     */
    onShutdown(callback: () => void | Promise<any>): void;
    protected getDefaultTransport(_: any): Transport;
    protected onShutdownCallback: () => void | Promise<any>;
    protected attachMatchMakingRoutes(server: http.Server): void;
    protected handleMatchMakeRequest(req: IncomingMessage, res: ServerResponse): Promise<void>;
}

import express from "express";
import { Server } from "colyseus";
export interface ArenaOptions {
    getId?: () => string;
    initializeExpress?: (app: express.Express) => void;
    initializeGameServer?: (app: Server) => void;
    beforeListen?: () => void;
}
export default function (options: ArenaOptions): ArenaOptions;
/**
 * Listen on your development environment
 * @param options Arena options
 * @param port Port number to bind Colyseus + Express
 */
export declare function listen(options: ArenaOptions, port?: number): void;

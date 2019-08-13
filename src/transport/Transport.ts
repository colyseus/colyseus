import * as net from "net";
import * as http from "http";
import * as https from "https";

import { Client, isValidId } from '..';
import { Protocol, decode, send } from "../Protocol";
import { MatchMaker } from '../MatchMaker';
import { MatchMakeError } from './../Errors';

import { debugError, debugAndPrintError } from './../Debug';
import { retry } from "../Utils";

export abstract class Transport {
    public server: net.Server | http.Server | https.Server;
    protected matchMaker: MatchMaker;

    constructor (matchMaker: MatchMaker) {
        this.matchMaker = matchMaker;
    }

    abstract listen(port?: number, hostname?: string, backlog?: number, listeningListener?: Function): this;
    abstract shutdown(): void;

    public address () { return this.server.address(); }
}

export { TCPTransport } from "./TCPTransport";
export { WebSocketTransport } from "./WebSocketTransport";
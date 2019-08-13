import * as http from 'http';
import * as https from 'https';
import * as net from 'net';

import { Client, isValidId } from '..';
import { MatchMaker } from '../MatchMaker';
import { decode, Protocol, send } from '../Protocol';
import { MatchMakeError } from './../Errors';

import { retry } from '../Utils';
import { debugAndPrintError, debugError } from './../Debug';

export abstract class Transport {
    public server: net.Server | http.Server | https.Server;
    protected matchMaker: MatchMaker;

    constructor(matchMaker: MatchMaker) {
        this.matchMaker = matchMaker;
    }

    public abstract listen(port?: number, hostname?: string, backlog?: number, listeningListener?: Function): this;
    public abstract shutdown(): void;

    public address() { return this.server.address(); }
}

export { TCPTransport } from './TCPTransport';
export { WebSocketTransport } from './WebSocketTransport';

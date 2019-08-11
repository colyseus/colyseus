import url from 'url';
import http from 'http';
import WebSocket from 'ws';

import { Client, Protocol, generateId } from '..';

import { Transport } from './Transport';
import { parseQueryString } from '../Utils';
import { MatchMaker, REMOTE_ROOM_LARGE_TIMEOUT } from '../MatchMaker';
import { send } from '../Protocol';
import { ServerOptions } from './../Server';

import { debugAndPrintError } from './../Debug';

function noop() {/* tslint:disable:no-empty */}
function heartbeat() { this.pingCount = 0; }

export class WebSocketTransport extends Transport {
    protected wss: WebSocket.Server;

    protected pingInterval: NodeJS.Timer;
    protected pingTimeout: number;

    constructor (matchMaker: MatchMaker, options: ServerOptions = {}, engine: any) {
        super(matchMaker);
        this.pingTimeout = (options.pingTimeout !== undefined)
            ? options.pingTimeout
            : 1500;

        const customVerifyClient: WebSocket.VerifyClientCallbackAsync = options.verifyClient;
        options.verifyClient = (info, next) => {
            if (!customVerifyClient) { return this.verifyClient(info, next); }

            customVerifyClient(info, (verified, code, message) => {
                if (!verified) { return next(verified, code, message); }

                this.verifyClient(info, next);
            });
        };

        this.wss = new engine(options);
        this.wss.on('connection', this.onConnection);

        this.server = options.server;

        if (this.pingTimeout > 0) {
            this.autoTerminateUnresponsiveClients(this.pingTimeout);
        }

        // interval to detect broken connections
        this.pingInterval = setInterval(() => {
            this.wss.clients.forEach((client: Client) => {
                //
                // if client hasn't responded after the interval, terminate its connection.
                //
                if (client.pingCount >= 2) {
                    return client.terminate();
                }

                client.pingCount++;
                client.ping(noop);
            });
        }, this.pingTimeout);
    }

    public listen(port: number, hostname?: string, backlog?: number, listeningListener?: Function) {
        this.server.listen(port, hostname, backlog, listeningListener);
        return this;
    }

    public shutdown () {
        clearInterval(this.pingInterval);
        this.wss.close();
        this.server.close();
    }

    protected autoTerminateUnresponsiveClients(pingTimeout: number) {
        // interval to detect broken connections
        this.pingInterval = setInterval(() => {
            this.wss.clients.forEach((client: Client) => {
                //
                // if client hasn't responded after the interval, terminate its connection.
                //
                if (client.pingCount >= 2) {
                    return client.terminate();
                }

                client.pingCount++;
                client.ping(noop);
            });
        }, pingTimeout);
    }

    protected verifyClient = async (info, next) => {
        const req = info.req;

        const parsedURL = url.parse(req.url);
        const processAndRoomId = parsedURL.pathname.match(/\/[a-zA-Z0-9_\-]+\/([a-zA-Z0-9_\-]+)$/);
        req.roomId = processAndRoomId && processAndRoomId[1];

        const query = parseQueryString(parsedURL.query);
        req.colyseusid = query.colyseusid;

        delete query.colyseusid;
        req.options = query;

        if (req.roomId) {
            try {
                // TODO: refactor me. this piece of code is repeated on MatchMaker class.
                const hasReservedSeat = query.sessionId && (await this.matchMaker.remoteRoomCall(
                    req.roomId,
                    'hasReservedSeat',
                    [query.sessionId],
                ))[1];

                if (!hasReservedSeat) {
                    const isLocked = (await this.matchMaker.remoteRoomCall(req.roomId, 'locked'))[1];

                    if (isLocked) {
                        return next(false, Protocol.WS_TOO_MANY_CLIENTS, 'maxClients reached.');
                    }
                }

                // verify client from room scope.
                const authResult = (await this.matchMaker.remoteRoomCall(
                    req.roomId,
                    'onAuth',
                    [req.options],
                    REMOTE_ROOM_LARGE_TIMEOUT,
                ))[1];

                if (authResult) {
                    req.auth = authResult;
                    next(true);

                } else {
                    throw new Error('onAuth failed.');
                }

            } catch (e) {
                if (e) { // user might have called `reject()` during onAuth without arguments.
                    debugAndPrintError(e.message + '\n' + e.stack);
                }

                next(false);
            }

        } else {
            next(true);
        }
    }

    protected onConnection = (client: Client, req?: http.IncomingMessage & any) => {
        // compatibility with ws / uws
        const upgradeReq = req || client.upgradeReq;

        // set client id
        client.id = upgradeReq.colyseusid || generateId();
        client.pingCount = 0;

        // ensure client has its "colyseusid"
        if (!upgradeReq.colyseusid) {
            send[Protocol.USER_ID](client);
        }

        // set client options
        client.options = upgradeReq.options;
        client.auth = upgradeReq.auth;

        // prevent server crashes if a single client had unexpected error
        client.on('error', (err) => debugAndPrintError(err.message + '\n' + err.stack));
        client.on('pong', heartbeat);

        const roomId = upgradeReq.roomId;
        if (roomId) {
            this.matchMaker.connectToRoom(client, upgradeReq.roomId).
                catch((e) => {
                    debugAndPrintError(e.stack || e);
                    send[Protocol.JOIN_ERROR](client, (e && e.message) || '');
                });

        } else {
            client.on('message', this.onMessageMatchMaking.bind(this, client));
        }
    }

}
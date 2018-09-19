import * as WebSocket from 'ws';
import * as http from 'http';
import * as parseURL from 'url-parse';

import { Client, Protocol, generateId } from '..';

import { Transport } from './Transport';
import { parseQueryString } from '../Utils';
import { MatchMaker, REMOTE_ROOM_LARGE_TIMEOUT } from '../MatchMaker';
import { send, decode } from '../Protocol';
import { ServerOptions } from './../Server';

import { debugError } from './../Debug';

function noop() {/* tslint:disable:no-empty */}
function heartbeat() { this.pingCount = 0; }

export class WebSocketTransport extends Transport {
    protected wss: WebSocket.Server;

    protected pingInterval: NodeJS.Timer;
    protected pingTimeout: number;

    constructor (matchMaker: MatchMaker, options: ServerOptions = {}, engine: any) {
        super(matchMaker);
        this.pingTimeout = options.pingTimeout || 1500;

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

    protected verifyClient = async (info, next) => {
        const req = info.req;
        const url = parseURL(req.url);
        req.roomId = url.pathname.substr(1);

        const query = parseQueryString(url.query);
        req.colyseusid = query.colyseusid;

        delete query.colyseusid;
        req.options = query;

        if (req.roomId) {
            try {
                // TODO: refactor me. this piece of code is repeated on MatchMaker class.
                const hasReservedSeat = query.sessionId && await this.matchMaker.remoteRoomCall(
                    req.roomId,
                    'hasReservedSeat',
                    [query.sessionId],
                );

                if (!hasReservedSeat) {
                    const isLocked = await this.matchMaker.remoteRoomCall(req.roomId, 'locked');

                    if (isLocked) {
                        return next(false, Protocol.WS_TOO_MANY_CLIENTS, 'maxClients reached.');
                    }
                }

                // verify client from room scope.
                const authResult = await this.matchMaker.remoteRoomCall(
                    req.roomId,
                    'onAuth',
                    [req.options],
                    REMOTE_ROOM_LARGE_TIMEOUT,
                );

                if (authResult) {
                    req.auth = authResult;
                    next(true);

                } else {
                    throw new Error('onAuth failed.');
                }

            } catch (e) {
                debugError(e.message + '\n' + e.stack);
                next(false);
            }

        } else {
            next(true);
        }
    }

    protected onConnection = (client: Client, req?: http.IncomingMessage & any) => {
        // compatibility with ws / uws
        const upgradeReq = req || client.upgradeReq || {};

        // set client id
        client.id = upgradeReq.colyseusid || generateId();
        client.pingCount = 0;

        // ensure client has its "colyseusid"
        if (!upgradeReq.colyseusid) {
            send(client, [Protocol.USER_ID, client.id]);
        }

        // set client options
        client.options = upgradeReq.options;
        client.auth = upgradeReq.auth;

        // prevent server crashes if a single client had unexpected error
        client.on('error', (err) => debugError(err.message + '\n' + err.stack));
        client.on('pong', heartbeat);

        const roomId = upgradeReq.roomId;
        if (roomId) {
            this.matchMaker.connectToRoom(client, upgradeReq.roomId).
                catch((e) => {
                    debugError(e.stack || e);
                    send(client, [Protocol.JOIN_ERROR, roomId, e && e.message]);
                });

        } else {
            client.on('message', (data) => this.onMessageMatchMaking(client, decode(data)));
        }
    }

}
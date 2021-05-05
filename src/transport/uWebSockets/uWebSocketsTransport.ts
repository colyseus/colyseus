import http from 'http';
import querystring from 'querystring';
import url, { URL } from 'url';
import uWebSockets from 'uWebSockets.js';

import * as matchMaker from '../../MatchMaker';
import * as matchMakerController from '../../matchmaker/controller';
import { ErrorCode, Protocol } from '../../Protocol';

import { ServerOptions } from '../../Server';
import { Transport } from '../Transport';

import { debugAndPrintError, debugConnection } from '../../Debug';
import { uWebSocketClient, uWebSocketWrapper } from './uWebSocketClient';
import { spliceOne } from '../../Utils';

type RawWebSocketClient = uWebSockets.WebSocket;

export class uWebSocketsTransport extends Transport {
    protected app: uWebSockets.TemplatedApp;

    protected clients: uWebSockets.WebSocket[] = [];
    protected clientWrappers = new WeakMap<uWebSockets.WebSocket, uWebSocketWrapper>();

    protected pingInterval: NodeJS.Timer;
    protected pingIntervalMS: number;
    protected pingMaxRetries: number;

    protected simulateLatencyMs: number;

    constructor(options: ServerOptions & uWebSockets.AppOptions = {}) {
        super();

        this.app = uWebSockets.App({
            // SSL options
        });

        this.pingIntervalMS = (options.pingInterval !== undefined)
            ? options.pingInterval
            : 3000;

        this.pingMaxRetries = (options.pingMaxRetries !== undefined)
            ? options.pingMaxRetries
            : 2;

        this.app.ws('/*', {
            //
            // disable idle timeout. 
            // use pingInterval/pingMaxRetries instead.
            //
            idleTimeout: 0, 

            upgrade: (res, req, context) => {
                /* This immediately calls open handler, you must not use res after this call */
                /* Spell these correctly */
                res.upgrade(
                    {
                        url: req.getUrl(),
                        query: req.getQuery(),
                    }, req.getHeader('sec-websocket-key'),
                    req.getHeader('sec-websocket-protocol'),
                    req.getHeader('sec-websocket-extensions'),
                    context
                );

            },

            open: (ws: uWebSockets.WebSocket) => {
                ws.pingCount = 0;
                this.onConnection(ws);

                if (this.simulateLatencyMs) {
                    const originalSend = ws.send;
                    ws.send = (recognizedString, isBinary?, compress?) => {
                        setTimeout(() => originalSend(recognizedString, true, false), this.simulateLatencyMs);
                        return true;
                    };
                }
            },

            pong: (ws: uWebSockets.WebSocket) => {
                ws.pingCount = 0;
            },

            close: (ws: uWebSockets.WebSocket, code: number, message: ArrayBuffer) => {
                // remove from client list
                spliceOne(this.clients, this.clients.indexOf(ws));

                // emit 'close' on wrapper
                this.clientWrappers.get(ws)?.emit('close', code);
                this.clientWrappers.delete(ws);
            },

            message: (ws: uWebSockets.WebSocket, message: ArrayBuffer, isBinary) => {
                // emit 'close' on wrapper
                this.clientWrappers.get(ws)?.emit('message', Buffer.from(message));
            },

        });

        this.server = options.server;

        this.registerMatchMakeRequest();

        // if (this.pingIntervalMS > 0 && this.pingMaxRetries > 0) {
        //     this.server.on('listening', () =>
        //         this.autoTerminateUnresponsiveClients(this.pingIntervalMS, this.pingMaxRetries));

        //     this.server.on('close', () =>
        //         clearInterval(this.pingInterval));
        // }
    }

    public listen(port: number, hostname?: string, backlog?: number, listeningListener?: () => void) {
        this.app.listen(port, (socket) => listeningListener?.());
        return this;
    }

    public shutdown() {
        // this.app.close();
        // this.server.close();
    }

    public simulateLatency(milliseconds: number) {
        this.simulateLatencyMs = milliseconds;
    }

    protected autoTerminateUnresponsiveClients(pingInterval: number, pingMaxRetries: number) {
        // interval to detect broken connections
        this.pingInterval = setInterval(() => {
            this.clients.forEach((client: RawWebSocketClient) => {
                //
                // if client hasn't responded after the interval, terminate its connection.
                //
                if (client.pingCount >= pingMaxRetries) {
                    // debugConnection(`terminating unresponsive client ${client.sessionId}`);
                    debugConnection(`terminating unresponsive client`);
                    return client.terminate();
                }

                client.pingCount++;
                client.ping();
            });
        }, pingInterval);
    }

    protected async onConnection(rawClient: RawWebSocketClient) {
        const wrapper = new uWebSocketWrapper(rawClient);
        // keep reference to client and its wrapper
        this.clients.push(rawClient);
        this.clientWrappers.set(rawClient, wrapper);

        const query = rawClient.query;
        const url = rawClient.url;

        const sessionId = querystring.parse(query).sessionId as string;
        const processAndRoomId = url.match(/\/[a-zA-Z0-9_\-]+\/([a-zA-Z0-9_\-]+)$/);
        const roomId = processAndRoomId && processAndRoomId[1];

        const room = matchMaker.getRoomById(roomId);
        const client = new uWebSocketClient(sessionId, wrapper);

        try {
            if (!room || !room.hasReservedSeat(sessionId)) {
                throw new Error('seat reservation expired.');
            }

            await room._onJoin(client, rawClient as unknown as http.IncomingMessage);

        } catch (e) {
            debugAndPrintError(e);

            // send error code to client then terminate
            client.error(e.code, e.message, () => rawClient.close());
        }
    }

    protected registerMatchMakeRequest() {
        const headers = {
            'Access-Control-Allow-Headers': 'Origin, X-Requested-With, Content-Type, Accept',
            'Access-Control-Allow-Methods': 'OPTIONS, POST, GET',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Max-Age': 2592000,
            // ...
        };

        // TODO: DRY with Server.ts
        const matchmakeRoute = 'matchmake';
        const allowedRoomNameChars = /([a-zA-Z_\-0-9]+)/gi;

        const writeHeaders = (res: uWebSockets.HttpResponse) => {
            for (const header in headers) {
                res.writeHeader(header, headers[header].toString());
            }
        }

        const writeError = (res: uWebSockets.HttpResponse, e: { error: number, message: string }) => {
            res.write(JSON.stringify(e))
            res.writeStatus("406 Not Acceptable");
            res.end();
        }

        const onAborted = (req: uWebSockets.HttpRequest) =>
            console.warn("REQUEST ABORTED:", req.getMethod(), req.getUrl());

        this.app.options("/matchmake/*", (res, req) => {
            res.onAborted(() => onAborted(req));

            writeHeaders(res);
            res.writeStatus("204 No Content");
            res.end();
        });

        this.app.post("/matchmake/*", (res, req) => {
            res.onAborted(() => onAborted(req));

            writeHeaders(res);
            res.writeHeader('Content-Type', 'application/json');

            const url = req.getUrl();
            const matchedParams = url.match(allowedRoomNameChars);
            const matchmakeIndex = matchedParams.indexOf(matchmakeRoute);

            // read json body 
            this.readJson(res, async (clientOptions) => {

                const method = matchedParams[matchmakeIndex + 1];
                const name = matchedParams[matchmakeIndex + 2] || '';

                try {
                    const response = await matchMakerController.invokeMethod(method, name, clientOptions);
                    res.writeStatus("200 OK");
                    res.end(JSON.stringify(response));

                } catch (e) {
                    writeError(res, {
                        error: e.error || ErrorCode.MATCHMAKE_UNHANDLED,
                        message: e.message
                    });
                }

            }, () => {
                writeError(res, {
                    error: ErrorCode.APPLICATION_ERROR,
                    message: "failed to read json body"
                });
            })

        });

        // this.app.any("/*", (res, req) => {
        //     res.onAborted(() => onAborted(req));
        //     res.writeStatus("200 OK");
        // });

        this.app.get("/matchmake/*", async (res, req) => {
            writeHeaders(res);
            res.writeHeader('Content-Type', 'application/json');

            const url = req.getUrl();
            const matchedParams = url.match(allowedRoomNameChars);
            const roomName = matchedParams[matchedParams.length - 1];

            try {
                const response = await matchMakerController.getAvailableRooms(roomName || '')
                res.writeStatus("200 OK");
                res.end(JSON.stringify(response));

            } catch (e) {
                writeError(res, {
                    error: e.error || ErrorCode.MATCHMAKE_UNHANDLED,
                    message: e.message
                });
            }
        });
    }

    /* Helper function for reading a posted JSON body */
    /* Extracted from https://github.com/uNetworking/uWebSockets.js/blob/master/examples/JsonPost.js */
    private readJson(res: uWebSockets.HttpResponse, cb: (json: any) => void, err: () => void) {
        let buffer: any;
        /* Register data cb */
        res.onData((ab, isLast) => {
            let chunk = Buffer.from(ab);
            if (isLast) {
                let json;
                if (buffer) {
                    try {
                        // @ts-ignore
                        json = JSON.parse(Buffer.concat([buffer, chunk]));
                    } catch (e) {
                        /* res.close calls onAborted */
                        res.close();
                        return;
                    }
                    cb(json);
                } else {
                    try {
                        // @ts-ignore
                        json = JSON.parse(chunk);
                    } catch (e) {
                        /* res.close calls onAborted */
                        res.close();
                        return;
                    }
                    cb(json);
                }
            } else {
                if (buffer) {
                    buffer = Buffer.concat([buffer, chunk]);
                } else {
                    buffer = Buffer.concat([chunk]);
                }
            }
        });

        /* Register error cb */
        res.onAborted(err);
    }

}

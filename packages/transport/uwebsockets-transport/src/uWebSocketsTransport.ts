import http from 'http';
import querystring from 'querystring';
import uWebSockets from 'uWebSockets.js';

import { ErrorCode, matchMaker, Transport, debugAndPrintError, spliceOne } from '@colyseus/core';
import { uWebSocketClient, uWebSocketWrapper } from './uWebSocketClient';

export type TransportOptions = Omit<uWebSockets.WebSocketBehavior, "upgrade" | "open" | "pong" | "close" | "message">;

type RawWebSocketClient = uWebSockets.WebSocket & {
  headers: {[key: string]: string},
  connection: { remoteAddress: string },
};

export class uWebSocketsTransport extends Transport {
    public app: uWebSockets.TemplatedApp;

    protected clients: RawWebSocketClient[] = [];
    protected clientWrappers = new WeakMap<RawWebSocketClient, uWebSocketWrapper>();

    private _listeningSocket: any;

    constructor(options: TransportOptions = {}, appOptions: uWebSockets.AppOptions = {}) {
        super();

        this.app = (appOptions.cert_file_name && appOptions.key_file_name)
            ? uWebSockets.SSLApp(appOptions)
            : uWebSockets.App(appOptions);

        if (!options.maxBackpressure) {
            options.maxBackpressure = 1024 * 1024;
        }

        if (!options.compression) {
            options.compression = uWebSockets.DISABLED;
        }

        if (!options.maxPayloadLength) {
            options.maxPayloadLength = 1024 * 1024;
        }

        this.app.ws('/*', {
            ...options,

            upgrade: (res, req, context) => {
                // get all headers
                const headers: {[id: string]: string} = {};
                req.forEach((key, value) => headers[key] = value);

                /* This immediately calls open handler, you must not use res after this call */
                /* Spell these correctly */
                res.upgrade(
                    {
                        url: req.getUrl(),
                        query: req.getQuery(),

                        // compatibility with @colyseus/ws-transport
                        headers,
                        connection: {
                          remoteAddress: Buffer.from(res.getRemoteAddressAsText()).toString()
                        }
                    },
                    req.getHeader('sec-websocket-key'),
                    req.getHeader('sec-websocket-protocol'),
                    req.getHeader('sec-websocket-extensions'),
                    context
                );
            },

            open: async (ws: RawWebSocketClient) => {
                // ws.pingCount = 0;
                await this.onConnection(ws);
            },

            // pong: (ws: RawWebSocketClient) => {
            //     ws.pingCount = 0;
            // },

            close: (ws: RawWebSocketClient, code: number, message: ArrayBuffer) => {
                // remove from client list
                spliceOne(this.clients, this.clients.indexOf(ws));

                const clientWrapper = this.clientWrappers.get(ws);
                if (clientWrapper) {
                  this.clientWrappers.delete(ws);

                  // emit 'close' on wrapper
                  clientWrapper.emit('close', code);
                }
            },

            message: (ws: RawWebSocketClient, message: ArrayBuffer, isBinary: boolean) => {
                // emit 'close' on wrapper
                this.clientWrappers.get(ws)?.emit('message', Buffer.from(message.slice(0)));
            },

        });

        this.registerMatchMakeRequest();
    }

    public listen(port: number, hostname?: string, backlog?: number, listeningListener?: () => void) {
        this.app.listen(port, (listeningSocket: any) => {
          this._listeningSocket = listeningSocket;
          listeningListener?.();
        });
        return this;
    }

    public shutdown() {
        if (this._listeningSocket) {
            uWebSockets.us_listen_socket_close(this._listeningSocket);
        }
    }

    public simulateLatency(milliseconds: number) {
        const originalRawSend = uWebSocketClient.prototype.raw;
        uWebSocketClient.prototype.raw = function() {
          setTimeout(() => originalRawSend.apply(this, arguments), milliseconds);
        }
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

        //
        // TODO: DRY code below with all transports
        //

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

        const writeError = (res: uWebSockets.HttpResponse, error: { code: number, error: string }) => {
            res.writeStatus("406 Not Acceptable");
            res.end(JSON.stringify(error));
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
                    const response = await matchMaker.controller.invokeMethod(method, name, clientOptions);
                    res.writeStatus("200 OK");
                    res.end(JSON.stringify(response));

                } catch (e) {
                    debugAndPrintError(e);
                    writeError(res, {
                        code: e.code || ErrorCode.MATCHMAKE_UNHANDLED,
                        error: e.message
                    });
                }

            }, () => {
                writeError(res, {
                    code: ErrorCode.APPLICATION_ERROR,
                    error: "failed to read json body"
                });
            })

        });

        // this.app.any("/*", (res, req) => {
        //     res.onAborted(() => onAborted(req));
        //     res.writeStatus("200 OK");
        // });

        this.app.get("/matchmake/*", async (res, req) => {
            res.onAborted(() => onAborted(req));

            writeHeaders(res);
            res.writeHeader('Content-Type', 'application/json');

            const url = req.getUrl();
            const matchedParams = url.match(allowedRoomNameChars);
            const roomName = matchedParams[matchedParams.length - 1];

            try {
                const response = await matchMaker.controller.getAvailableRooms(roomName || '')
                res.writeStatus("200 OK");
                res.end(JSON.stringify(response));

            } catch (e) {
                debugAndPrintError(e);
                writeError(res, {
                    code: e.code || ErrorCode.MATCHMAKE_UNHANDLED,
                    error: e.message
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

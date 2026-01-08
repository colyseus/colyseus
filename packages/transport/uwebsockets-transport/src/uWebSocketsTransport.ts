import type { IncomingHttpHeaders } from 'http';
import querystring, { type ParsedUrlQuery } from 'querystring';
import uWebSockets, { type WebSocket } from 'uWebSockets.js';
import expressify, { Application } from "uwebsockets-express";

import { type AuthContext, Transport, HttpServerMock, ErrorCode, matchMaker, Protocol, getBearerToken, debugAndPrintError, spliceOne, connectClientToRoom } from '@colyseus/core';
import { uWebSocketClient, uWebSocketWrapper } from './uWebSocketClient.ts';

export type TransportOptions = Omit<uWebSockets.WebSocketBehavior<any>, "upgrade" | "open" | "pong" | "close" | "message">;

type RawWebSocketClient = uWebSockets.WebSocket<any> & {
  url: string,
  searchParams: ParsedUrlQuery,
  context: AuthContext,
};

export class uWebSocketsTransport extends Transport {
    public app: uWebSockets.TemplatedApp;

    protected clients: RawWebSocketClient[] = [];
    protected clientWrappers = new WeakMap<RawWebSocketClient, uWebSocketWrapper>();

    private _listeningSocket: any;
    private _originalRawSend: typeof uWebSocketClient.prototype.raw | null = null;

    constructor(options: TransportOptions = {}, appOptions: uWebSockets.AppOptions = {}) {
        super();

        this.app = (appOptions.cert_file_name && appOptions.key_file_name)
            ? uWebSockets.SSLApp(appOptions)
            : uWebSockets.App(appOptions);

        if (options.maxBackpressure === undefined) {
            options.maxBackpressure = 1024 * 1024;
        }

        if (options.compression === undefined) {
            options.compression = uWebSockets.DISABLED;
        }

        if (options.maxPayloadLength === undefined) {
            options.maxPayloadLength = 4 * 1024;
        }

        if (options.sendPingsAutomatically === undefined) {
            options.sendPingsAutomatically = true;
        }

        // https://github.com/colyseus/colyseus/issues/458
        // Adding a mock object for Transport.server
        if(!this.server) {
          // @ts-ignore
          this.server = new HttpServerMock();
        }

        this.app.ws('/*', {
            ...options,

            upgrade: (res, req, context) => {
                // get all headers
                const headers: {[id: string]: string} = {};
                req.forEach((key, value) => headers[key] = value);

                const searchParams = querystring.parse(req.getQuery());

                /* This immediately calls open handler, you must not use res after this call */
                /* Spell these correctly */
                res.upgrade(
                    {
                        url: req.getUrl(),
                        searchParams,
                        context: {
                          token: searchParams._authToken ?? getBearerToken(req.getHeader('authorization')),
                          headers,
                          ip: headers['x-real-ip'] ?? headers['x-forwarded-for'] ?? Buffer.from(res.getRemoteAddressAsText()).toString(),
                        }
                    },
                    req.getHeader('sec-websocket-key'),
                    req.getHeader('sec-websocket-protocol'),
                    req.getHeader('sec-websocket-extensions'),
                    context
                );
            },

            open: async (ws: WebSocket<any>) => {
                // ws.pingCount = 0;
                await this.onConnection(ws as RawWebSocketClient);
            },

            // pong: (ws: RawWebSocketClient) => {
            //     ws.pingCount = 0;
            // },

            close: (ws: WebSocket<any>, code: number, message: ArrayBuffer) => {
                // remove from client list
                spliceOne(this.clients, this.clients.indexOf(ws as RawWebSocketClient));

                const clientWrapper = this.clientWrappers.get(ws as RawWebSocketClient);
                if (clientWrapper) {
                  this.clientWrappers.delete(ws as RawWebSocketClient);

                  // emit 'close' on wrapper
                  clientWrapper.emit('close', code);
                }
            },

            message: (ws: WebSocket<any>, message: ArrayBuffer, isBinary: boolean) => {
                // emit 'message' on wrapper
                this.clientWrappers.get(ws as RawWebSocketClient)?.emit('message', Buffer.from(message));
            },

        });

        this.registerMatchMakeRequest();
    }

    public listen(port: number, hostname?: string, backlog?: number, listeningListener?: () => void) {
        const callback = (listeningSocket: any) => {
          this._listeningSocket = listeningSocket;
          listeningListener?.();
          // @ts-ignore
          this.server.emit("listening"); // Mocking Transport.server behaviour, https://github.com/colyseus/colyseus/issues/458
        };

        if (typeof(port) === "string") {
            // @ts-ignore
            this.app.listen_unix(callback, port);

        } else {
            this.app.listen(port, callback);

        }
        return this;
    }

    public shutdown() {
        if (this._listeningSocket) {
          uWebSockets.us_listen_socket_close(this._listeningSocket);
          // @ts-ignore
          this.server.emit("close"); // Mocking Transport.server behaviour, https://github.com/colyseus/colyseus/issues/458
        }
    }

    public simulateLatency(milliseconds: number) {
        if (this._originalRawSend == null) {
            this._originalRawSend = uWebSocketClient.prototype.raw;
        }

        const originalRawSend = this._originalRawSend;
        uWebSocketClient.prototype.raw = milliseconds <= Number.EPSILON ? originalRawSend : function (...args: any[]) {
            // copy buffer
            let [buf, ...rest] = args;
            buf = Buffer.from(buf);
            // @ts-ignore
            setTimeout(() => originalRawSend.apply(this, [buf, ...rest]), milliseconds);
        };
    }

    protected async onConnection(rawClient: RawWebSocketClient) {
        const wrapper = new uWebSocketWrapper(rawClient);
        // keep reference to client and its wrapper
        this.clients.push(rawClient);
        this.clientWrappers.set(rawClient, wrapper);

        const url = rawClient.url;
        const searchParams = rawClient.searchParams;

        const sessionId = searchParams.sessionId as string;
        const processAndRoomId = url.match(/\/[a-zA-Z0-9_\-]+\/([a-zA-Z0-9_\-]+)$/);
        const roomId = processAndRoomId && processAndRoomId[1];

        // If sessionId is not provided, allow ping-pong utility.
        if (!sessionId && !roomId) {
          // Disconnect automatically after 1 second if no message is received.
          const timeout = setTimeout(() => rawClient.close(), 1000);
          wrapper.on('message', (_) => rawClient.send(new Uint8Array([Protocol.PING]), true));
          wrapper.on('close', () => clearTimeout(timeout));
          return;
        }

        const room = matchMaker.getLocalRoomById(roomId);
        const client = new uWebSocketClient(sessionId, wrapper);
        const reconnectionToken = searchParams.reconnectionToken as string;
        const skipHandshake = (searchParams.skipHandshake !== undefined);

        try {
            await connectClientToRoom(room, client, rawClient.context, {
              reconnectionToken,
              skipHandshake
            });

        } catch (e: any) {
            debugAndPrintError(e);

            // send error code to client then terminate
            client.error(e.code, e.message, () => client.leave());
        }
    }

    protected registerMatchMakeRequest() {

        // TODO: DRY with Server.ts
        const matchmakeRoute = 'matchmake';
        const allowedRoomNameChars = /([a-zA-Z_\-0-9]+)/gi;

      const writeHeaders = (res: uWebSockets.HttpResponse, requestHeaders: Headers) => {
            // skip if aborted
            if (res.aborted) { return; }

            const headers = Object.assign(
                {},
                matchMaker.controller.DEFAULT_CORS_HEADERS,
                matchMaker.controller.getCorsHeaders(requestHeaders)
            );

            for (const header in headers) {
                res.writeHeader(header, headers[header].toString());
            }

            return true;
        }

        const writeError = (res: uWebSockets.HttpResponse, error: { code: number, error: string }) => {
            // skip if aborted
            if (res.aborted) { return; }

            res.cork(() => {
              res.writeStatus("406 Not Acceptable");
              res.end(JSON.stringify(error));
            });
        }

        const onAborted = (res: uWebSockets.HttpResponse) => {
          res.aborted = true;
        };

        this.app.options("/matchmake/*", (res, req) => {
            res.onAborted(() => onAborted(res));

            // cache all headers
            const reqHeaders = new Headers();
            req.forEach((key, value) => reqHeaders.set(key, value));

            if (writeHeaders(res, reqHeaders)) {
              res.writeStatus("204 No Content");
              res.end();
            }
        });


        // @ts-ignore
        this.app.post("/matchmake/*", (res, req) => {
            res.onAborted(() => onAborted(res));

            // do not accept matchmaking requests if already shutting down
            if (matchMaker.state === matchMaker.MatchMakerState.SHUTTING_DOWN) {
              return res.close();
            }

            // cache all headers
            const headers = new Headers();
            req.forEach((key, value) => headers.set(key, value));

            writeHeaders(res, headers);
            res.writeHeader('Content-Type', 'application/json');

            const url = req.getUrl();
            const matchedParams = url.match(allowedRoomNameChars);
            const matchmakeIndex = matchedParams.indexOf(matchmakeRoute);

            const token = getBearerToken(headers['authorization']);

            // read json body
            this.readJson(res, async (clientOptions) => {
                try {
                    if (clientOptions === undefined) {
                      throw new Error("invalid JSON input");
                    }

                    const method = matchedParams[matchmakeIndex + 1];
                    const roomName = matchedParams[matchmakeIndex + 2] || '';

                    const response = await matchMaker.controller.invokeMethod(
                      method,
                      roomName,
                      clientOptions,
                      {
                        token,
                        headers,
                        ip: headers.get('x-real-ip') ?? headers.get('x-forwarded-for') ?? Buffer.from(res.getRemoteAddressAsText()).toString()
                      }
                    );

                    if (!res.aborted) {
                      res.cork(() => {
                        res.writeStatus("200 OK");
                        res.end(JSON.stringify(response));
                      });
                    }

                } catch (e: any) {
                    debugAndPrintError(e);
                    writeError(res, {
                        code: e.code || ErrorCode.MATCHMAKE_UNHANDLED,
                        error: e.message
                    });
                }

            });
        });
    }

    /* Helper function for reading a posted JSON body */
    /* Extracted from https://github.com/uNetworking/uWebSockets.js/blob/master/examples/JsonPost.js */
    private readJson(res: uWebSockets.HttpResponse, cb: (json: any) => void) {
        let buffer: Buffer;
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
                        // res.close();
                        cb(undefined);
                        return;
                    }
                    cb(json);
                } else {
                    try {
                        // @ts-ignore
                        json = JSON.parse(chunk);
                    } catch (e) {
                        /* res.close calls onAborted */
                        // res.close();
                        cb(undefined);
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
    }
}

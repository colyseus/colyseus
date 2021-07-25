"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.uWebSocketsTransport = void 0;
const querystring_1 = __importDefault(require("querystring"));
const uWebSockets_js_1 = __importDefault(require("uWebSockets.js"));
const core_1 = require("@colyseus/core");
const uWebSocketClient_1 = require("./uWebSocketClient");
class uWebSocketsTransport extends core_1.Transport {
    constructor(options = {}, appOptions = {}) {
        super();
        this.clients = [];
        this.clientWrappers = new WeakMap();
        this.app = (appOptions.cert_file_name && appOptions.key_file_name)
            ? uWebSockets_js_1.default.SSLApp(appOptions)
            : uWebSockets_js_1.default.App(appOptions);
        if (!options.maxBackpressure) {
            options.maxBackpressure = 1024 * 1024;
        }
        if (!options.compression) {
            options.compression = uWebSockets_js_1.default.DISABLED;
        }
        if (!options.maxPayloadLength) {
            options.maxPayloadLength = 1024 * 1024;
        }
        this.app.ws('/*', {
            ...options,
            upgrade: (res, req, context) => {
                // get all headers
                const headers = {};
                req.forEach((key, value) => headers[key] = value);
                /* This immediately calls open handler, you must not use res after this call */
                /* Spell these correctly */
                res.upgrade({
                    url: req.getUrl(),
                    query: req.getQuery(),
                    // compatibility with @colyseus/ws-transport
                    headers,
                    connection: {
                        remoteAddress: Buffer.from(res.getRemoteAddressAsText()).toString()
                    }
                }, req.getHeader('sec-websocket-key'), req.getHeader('sec-websocket-protocol'), req.getHeader('sec-websocket-extensions'), context);
            },
            open: async (ws) => {
                // ws.pingCount = 0;
                await this.onConnection(ws);
            },
            // pong: (ws: RawWebSocketClient) => {
            //     ws.pingCount = 0;
            // },
            close: (ws, code, message) => {
                // remove from client list
                core_1.spliceOne(this.clients, this.clients.indexOf(ws));
                const clientWrapper = this.clientWrappers.get(ws);
                if (clientWrapper) {
                    this.clientWrappers.delete(ws);
                    // emit 'close' on wrapper
                    clientWrapper.emit('close', code);
                }
            },
            message: (ws, message, isBinary) => {
                // emit 'close' on wrapper
                this.clientWrappers.get(ws)?.emit('message', Buffer.from(message.slice(0)));
            },
        });
        this.registerMatchMakeRequest();
    }
    listen(port, hostname, backlog, listeningListener) {
        this.app.listen(port, (listeningSocket) => {
            this._listeningSocket = listeningSocket;
            listeningListener?.();
        });
        return this;
    }
    shutdown() {
        if (this._listeningSocket) {
            uWebSockets_js_1.default.us_listen_socket_close(this._listeningSocket);
        }
    }
    simulateLatency(milliseconds) {
        const originalRawSend = uWebSocketClient_1.uWebSocketClient.prototype.raw;
        uWebSocketClient_1.uWebSocketClient.prototype.raw = function () {
            setTimeout(() => originalRawSend.apply(this, arguments), milliseconds);
        };
    }
    async onConnection(rawClient) {
        const wrapper = new uWebSocketClient_1.uWebSocketWrapper(rawClient);
        // keep reference to client and its wrapper
        this.clients.push(rawClient);
        this.clientWrappers.set(rawClient, wrapper);
        const query = rawClient.query;
        const url = rawClient.url;
        const sessionId = querystring_1.default.parse(query).sessionId;
        const processAndRoomId = url.match(/\/[a-zA-Z0-9_\-]+\/([a-zA-Z0-9_\-]+)$/);
        const roomId = processAndRoomId && processAndRoomId[1];
        const room = core_1.matchMaker.getRoomById(roomId);
        const client = new uWebSocketClient_1.uWebSocketClient(sessionId, wrapper);
        //
        // TODO: DRY code below with all transports
        //
        try {
            if (!room || !room.hasReservedSeat(sessionId)) {
                throw new Error('seat reservation expired.');
            }
            await room._onJoin(client, rawClient);
        }
        catch (e) {
            core_1.debugAndPrintError(e);
            // send error code to client then terminate
            client.error(e.code, e.message, () => rawClient.close());
        }
    }
    registerMatchMakeRequest() {
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
        const writeHeaders = (res) => {
            for (const header in headers) {
                res.writeHeader(header, headers[header].toString());
            }
        };
        const writeError = (res, error) => {
            res.writeStatus("406 Not Acceptable");
            res.end(JSON.stringify(error));
        };
        const onAborted = (req) => console.warn("REQUEST ABORTED:", req.getMethod(), req.getUrl());
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
                    const response = await core_1.matchMaker.controller.invokeMethod(method, name, clientOptions);
                    res.writeStatus("200 OK");
                    res.end(JSON.stringify(response));
                }
                catch (e) {
                    core_1.debugAndPrintError(e);
                    writeError(res, {
                        code: e.code || core_1.ErrorCode.MATCHMAKE_UNHANDLED,
                        error: e.message
                    });
                }
            }, () => {
                writeError(res, {
                    code: core_1.ErrorCode.APPLICATION_ERROR,
                    error: "failed to read json body"
                });
            });
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
                const response = await core_1.matchMaker.controller.getAvailableRooms(roomName || '');
                res.writeStatus("200 OK");
                res.end(JSON.stringify(response));
            }
            catch (e) {
                core_1.debugAndPrintError(e);
                writeError(res, {
                    code: e.code || core_1.ErrorCode.MATCHMAKE_UNHANDLED,
                    error: e.message
                });
            }
        });
    }
    /* Helper function for reading a posted JSON body */
    /* Extracted from https://github.com/uNetworking/uWebSockets.js/blob/master/examples/JsonPost.js */
    readJson(res, cb, err) {
        let buffer;
        /* Register data cb */
        res.onData((ab, isLast) => {
            let chunk = Buffer.from(ab);
            if (isLast) {
                let json;
                if (buffer) {
                    try {
                        // @ts-ignore
                        json = JSON.parse(Buffer.concat([buffer, chunk]));
                    }
                    catch (e) {
                        /* res.close calls onAborted */
                        res.close();
                        return;
                    }
                    cb(json);
                }
                else {
                    try {
                        // @ts-ignore
                        json = JSON.parse(chunk);
                    }
                    catch (e) {
                        /* res.close calls onAborted */
                        res.close();
                        return;
                    }
                    cb(json);
                }
            }
            else {
                if (buffer) {
                    buffer = Buffer.concat([buffer, chunk]);
                }
                else {
                    buffer = Buffer.concat([chunk]);
                }
            }
        });
        /* Register error cb */
        res.onAborted(err);
    }
}
exports.uWebSocketsTransport = uWebSocketsTransport;
//# sourceMappingURL=uWebSocketsTransport.js.map
import querystring, { type ParsedUrlQuery } from 'querystring';
import uWebSockets, { type WebSocket } from 'uWebSockets.js';
import type express from 'express';

import { type AuthContext, Transport, matchMaker, Protocol, getBearerToken, debugAndPrintError, spliceOne, connectClientToRoom, CloseCode, type Router } from '@colyseus/core';
import { uWebSocketClient, uWebSocketWrapper } from './uWebSocketClient.ts';
import { Deferred } from '@colyseus/core';

const uWebSocketsExpress = new Deferred<typeof import('uwebsockets-express')>;
let uWebSocketsExpressModule: typeof import('uwebsockets-express') | undefined = undefined;
import('uwebsockets-express')
  .then((module) => uWebSocketsExpress.resolve(module))
  .catch((error) => uWebSocketsExpress.reject(error));

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
  private _expressApp?: express.Application;

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

    this.app.ws('/*', {
      ...options,

      upgrade: (res, req, context) => {
        // get all headers
        const headers: { [id: string]: string } = {};
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
  }

  public getExpressApp(): Promise<express.Application> | express.Application {
    if (!this._expressApp) {
      return new Promise(async (resolve, reject) => {
        try {
          const module = await uWebSocketsExpress;
          uWebSocketsExpressModule = module;

          // Temporarily stub `app.any` to prevent uwebsockets-express Application.init()
          // from registering its own catch-all handler — we manage HTTP routing ourselves
          // in bindRouter().
          const originalAny = this.app.any;
          this.app.any = (() => this.app) as any;
          this._expressApp = (module.default(this.app) as unknown) as express.Application;
          this.app.any = originalAny;
          resolve(this._expressApp);
        } catch (error) {
          reject(error);
          console.warn("");
          console.warn("❌ Error: could not initialize express.");
          console.warn("");
          console.warn("    For Express v5, use:");
          console.warn("    👉 npm install --save uwebsockets-express@^2.0.1");
          console.warn("");
          console.warn("    For Express v4, use:");
          console.warn("    👉 npm install --save uwebsockets-express@^1.4.1");
          console.warn("");
          process.exit();
        }
      });
    }
    return this._expressApp;
  }

  public bindRouter(router: Router) {
    const getCorsHeaders = (requestHeaders: Headers) => {
      return Object.assign(
        {},
        matchMaker.controller.DEFAULT_CORS_HEADERS,
        matchMaker.controller.getCorsHeaders(requestHeaders)
      );
    }

    const writeCorsHeaders = (res: uWebSockets.HttpResponse, requestHeaders: Headers) => {
      // skip if aborted
      if (res.aborted) { return; }

      const headers = getCorsHeaders(requestHeaders);

      for (const header in headers) {
        res.writeHeader(header, headers[header].toString());
      }

      return true;
    }

    this.app.options("/*", (res, req) => {
      res.onAborted(() => res.aborted = true);

      // cache all headers
      const reqHeaders = new Headers();
      req.forEach((key, value) => reqHeaders.set(key, value));

      res.cork(() => {
        res.writeStatus("204 No Content");
        writeCorsHeaders(res, reqHeaders);
        res.end();
      });
    });

    this.app.any('/*', async (res, req) => {
      const abortController = new AbortController();

      res.onAborted(() => {
        abortController.abort();
        res.aborted = true;
      });

      // cache all headers and request info synchronously
      // (uWebSockets.js req is only valid in the synchronous callback scope)
      const headers = new Headers();
      req.forEach((key, value) => headers.set(key, value));

      const method = req.getMethod().toUpperCase();
      const url = req.getUrl();
      const query = req.getQuery();
      const remoteAddress = res.getRemoteAddressAsText();

      // check if the route is defined in the router
      // if so, use the router handler, otherwise fallback to express
      if (router.findRoute(method, url) !== undefined) {
        const requestInit: RequestInit = {
          method,
          referrer: headers.get('referer') || undefined,
          keepalive: headers.get('keep-alive') === 'true',
          headers,
          signal: abortController.signal,
        };

        // read request body
        if (method !== "GET" && method !== "HEAD") {
          let body: Buffer = undefined;

          // uWebSockets.js `HttpRequest` does not provide 'getData', must aggregate POST body via HttpResponse
          await new Promise<void>((resolve) => {
            res.onData((ab, isLast) => {
              const chunk = Buffer.from(ab);
              if (body === undefined) {
                body = Buffer.from(chunk);
              } else {
                body = Buffer.concat([body, chunk]);
              }
              if (isLast) {
                resolve();
              }
            });
          });

          requestInit.body = body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer;
        }

        const fullUrl = `http://${headers.get('host') || 'localhost'}${url}${(query ? `?${query}` : '')}`;
        const response = await router.handler(new Request(fullUrl, requestInit));

        // skip if aborted
        if (res.aborted) { return; }

        // read response body before cork (cork callback must be synchronous)
        const responseBody = await response.arrayBuffer();

        // writeStatus() must be called before writeHeader() in uWebSockets.js
        res.cork(() => {
          res.writeStatus(`${response.status} ${response.statusText}`);
          writeCorsHeaders(res, headers);
          response.headers.forEach((value, key) => {
            if (key.toLowerCase() !== 'content-length') {
              res.writeHeader(key, value);
            }
          });
          res.end(responseBody);
        });

      } else if (this._expressApp) {
        const corsHeaders = getCorsHeaders(headers);

        const ereq = new uWebSocketsExpressModule.IncomingMessage(req, res, this._expressApp as any, {
          headers: Object.fromEntries((headers as any).entries()),
          method,
          url,
          query,
          remoteAddress
        });
        const eres = new uWebSocketsExpressModule.ServerResponse(res, req, this._expressApp);

        // Apply CORS headers through the Express response wrapper
        for (const header in corsHeaders) {
          eres.setHeader(header, corsHeaders[header].toString());
        }

        // Read the request body from uWebSockets before passing to express
        // (uWebSockets requires res.onData() to be called to consume the body)
        await ereq._readBody();

        this._expressApp['handle'](ereq, eres);
      }
    });
  }

  public listen(port: number, hostname?: string, backlog?: number, listeningListener?: () => void) {
    const callback = (listeningSocket: any) => {
      this._listeningSocket = listeningSocket;
      listeningListener?.();
    };

    if (typeof (port) === "string") {
      this.app.listen_unix(callback, port);

    } else {
      this.app.listen(port, callback);

    }
    return this;
  }

  public shutdown() {
    if (this._listeningSocket) {
      uWebSockets.us_listen_socket_close(this._listeningSocket);
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
      client.error(e.code, e.message, () =>
        rawClient.end(reconnectionToken
          ? CloseCode.FAILED_TO_RECONNECT
          : CloseCode.WITH_ERROR));
    }
  }

}

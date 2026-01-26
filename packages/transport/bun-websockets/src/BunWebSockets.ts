// <reference types="bun-types" />

// "bun-types" is currently conflicting with "ws" types.
// @ts-ignore
import { Server, ServerWebSocket, WebSocketHandler } from 'bun';
import express, { type  Application } from "express";
import type { Router } from '@colyseus/core';

import { matchMaker, Protocol, Transport, debugAndPrintError, getBearerToken, CloseCode, connectClientToRoom, spliceOne } from '@colyseus/core';
import { WebSocketClient, WebSocketWrapper } from './WebSocketClient.ts';

// Bun global is available at runtime
declare const Bun: any;

export type TransportOptions = Partial<Omit<WebSocketHandler<WebSocketData>, "message" | "open" | "drain" | "close" | "ping" | "pong">>;

interface WebSocketData {
  url: string;
  searchParams: URLSearchParams;
  headers: Headers;
  remoteAddress: string;
}

export class BunWebSockets extends Transport {
  protected clients: ServerWebSocket<WebSocketData>[] = [];
  protected clientWrappers = new WeakMap<ServerWebSocket<WebSocketData>, WebSocketWrapper>();

  private _server: Server<WebSocketData> | undefined;
  private _expressApp: Application | undefined;
  private _router: Router | undefined;
  private _originalRawSend: typeof WebSocketClient.prototype.raw | null = null;
  private options: TransportOptions = {};

  constructor(options: TransportOptions = {}) {
    super();
    this.options = options;
  }

  public getExpressApp(): Application {
    if (!this._expressApp) {
      this._expressApp = express();
    }
    return this._expressApp;
  }

  public bindRouter(router: Router) {
    this._router = router;
  }

  public listen(port: number, hostname?: string, backlog?: number, listeningListener?: () => void) {
    const self = this;

    this._server = Bun.serve({
      port,
      hostname,

      async fetch(req, server) {
        const url = new URL(req.url);

        // Try to upgrade to WebSocket
        if (server.upgrade(req, {
          data: {
            url: url.pathname + url.search,
            searchParams: url.searchParams,
            headers: req.headers as Headers,
            remoteAddress: server.requestIP(req)?.address || 'unknown',
          }
        })) {
          return; // WebSocket upgrade successful
        }

        // Handle HTTP requests through router
        if (self._router) {
          try {
            // Write CORS headers
            const corsHeaders = {
              ...matchMaker.controller.DEFAULT_CORS_HEADERS,
              ...matchMaker.controller.getCorsHeaders(req.headers)
            };

            // Handle OPTIONS requests
            if (req.method === "OPTIONS") {
              return new Response(null, {
                status: 204,
                headers: corsHeaders
              });
            }

            const response = await self._router.handler(req);

            // Add CORS headers to response
            const headers = new Headers(response.headers);
            Object.entries(corsHeaders).forEach(([key, value]) => {
              if (!headers.has(key)) {
                headers.set(key, value.toString());
              }
            });

            return new Response(response.body, {
              status: response.status,
              statusText: response.statusText,
              headers
            });

          } catch (e: any) {
            debugAndPrintError(e);
            return new Response(JSON.stringify({
              code: e.code,
              error: e.message
            }), {
              status: 500,
              headers: { 'Content-Type': 'application/json' }
            });
          }
        }

        // Fallback to express app if available
        if (self._expressApp) {
          // TODO: Implement express integration for Bun
          console.warn("Express integration not yet implemented for BunWebSockets");
        }

        return new Response("Not Found", { status: 404 });
      },

      websocket: {
        ...this.options,

        async open(ws) {
          await self.onConnection(ws);
        },

        message(ws, message) {
          self.clientWrappers.get(ws)?.emit('message', message);
        },

        close(ws, code, reason) {
          // remove from client list
          spliceOne(self.clients, self.clients.indexOf(ws));

          const clientWrapper = self.clientWrappers.get(ws);
          if (clientWrapper) {
            self.clientWrappers.delete(ws);

            // emit 'close' on wrapper
            clientWrapper.emit('close', code);
          }
        },
      }
    });

    listeningListener?.();

    return this;
  }

  public shutdown() {
    if (this._server) {
      this._server.stop();
    }
  }

  public simulateLatency(milliseconds: number) {
    if (this._originalRawSend == null) {
      this._originalRawSend = WebSocketClient.prototype.raw;
    }

    const originalRawSend = this._originalRawSend;
    WebSocketClient.prototype.raw = milliseconds <= Number.EPSILON ? originalRawSend : function (...args: any[]) {
      let [buf, ...rest] = args;
      buf = Buffer.from(buf);
      // @ts-ignore
      setTimeout(() => originalRawSend.apply(this, [buf, ...rest]), milliseconds);
    };
  }

  protected async onConnection(rawClient: ServerWebSocket<WebSocketData>) {
    const wrapper = new WebSocketWrapper(rawClient);
    // keep reference to client and its wrapper
    this.clients.push(rawClient);
    this.clientWrappers.set(rawClient, wrapper);

    const url = rawClient.data.url;
    const searchParams = rawClient.data.searchParams;

    const sessionId = searchParams.get("sessionId");
    const processAndRoomId = url.match(/\/[a-zA-Z0-9_\-]+\/([a-zA-Z0-9_\-]+)$/);
    const roomId = processAndRoomId && processAndRoomId[1];

    // If sessionId is not provided, allow ping-pong utility.
    if (!sessionId && !roomId) {
      // Disconnect automatically after 1 second if no message is received.
      const timeout = setTimeout(() => rawClient.close(CloseCode.NORMAL_CLOSURE), 1000);
      wrapper.on('message', (_) => rawClient.send(new Uint8Array([Protocol.PING])));
      wrapper.on('close', () => clearTimeout(timeout));
      return;
    }

    const room = matchMaker.getLocalRoomById(roomId);
    const client = new WebSocketClient(sessionId, wrapper);
    const reconnectionToken = searchParams.get("reconnectionToken");
    const skipHandshake = searchParams.has("skipHandshake");

    try {
      await connectClientToRoom(room, client, {
        token: searchParams.get("_authToken") ?? getBearerToken(rawClient.data.headers['authorization']),
        headers: rawClient.data.headers,
        ip: rawClient.data.headers['x-real-ip'] ?? rawClient.data.headers['x-forwarded-for'] ?? rawClient.data.remoteAddress,
      }, {
        reconnectionToken,
        skipHandshake
      });

    } catch (e: any) {
      debugAndPrintError(e);

      // send error code to client then terminate
      client.error(e.code, e.message, () => rawClient.close());
    }
  }

}

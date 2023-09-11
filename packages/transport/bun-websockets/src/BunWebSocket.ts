/// <reference types="bun-types" />
import Bun, { Server, ServerWebSocket, WebSocketHandler } from "bun";

import http from 'http';

import { DummyServer, ErrorCode, matchMaker, Transport, debugAndPrintError, spliceOne, ServerError } from '@colyseus/core';
import { WebSocketClient, WebSocketWrapper } from './WebSocketClient';

export type TransportOptions = Partial<Omit<WebSocketHandler, "message" | "open" | "drain" | "close" | "ping" | "pong">>;

interface WebSocketData {
  url: URL;
  // query: string,
  // headers: { [key: string]: string },
  // connection: { remoteAddress: string },
}

export class BunWebSocket extends Transport {
  public bunServer: Bun.Server;

  protected clients: ServerWebSocket<WebSocketData>[] = [];
  protected clientWrappers = new WeakMap<ServerWebSocket<WebSocketData>, WebSocketWrapper>();

  constructor(private options: TransportOptions = {}) {
    super();

    // Adding a mock object for Transport.server
    if (!this.server) {
      this.server = new DummyServer();
    }
  }

  public listen(port: number | string, hostname?: string, backlog?: number, listeningListener?: () => void) {
    const handleMatchMakeRequest = this.handleMatchMakeRequest;

    this.bunServer = Bun.serve<WebSocketData>({
      port,
      hostname,

      async fetch(req, server) {
        const url = new URL(req.url);

        if (url.pathname.startsWith(`/${matchMaker.controller.matchmakeRoute}`)) {
          try {
            const [code, response, headers] = await handleMatchMakeRequest(req, server, url);
            //
            // success response
            //
            return new Response(response, {
              status: code,
              headers: Object.assign(
                headers,
                matchMaker.controller.DEFAULT_CORS_HEADERS,
                matchMaker.controller.getCorsHeaders.call(undefined, req)
              )
            });

          } catch (e) {
            //
            // error response
            //
            return new Response(JSON.stringify({ code: e.code, error: e.message }), {
              status: e.code || ErrorCode.MATCHMAKE_UNHANDLED,
              headers: Object.assign(
                { 'Content-Type': 'application/json' },
                matchMaker.controller.DEFAULT_CORS_HEADERS,
                matchMaker.controller.getCorsHeaders.call(undefined, req)
              )
            });
          }


        } else {
          // req.headers.get("Cookie");
          server.upgrade(req, { data: { url } });

          return undefined;
        }
      },

      websocket: {
        ...this.options,

        async open(ws) {
          await this.onConnection(ws);
        },

        message(ws, message) {
          // this.clientWrappers.get(ws)?.emit('message', Buffer.from(message.slice(0)));
          this.clientWrappers.get(ws)?.emit('message', message);
        },

        close(ws, code, reason) {
          // remove from client list
          spliceOne(this.clients, this.clients.indexOf(ws));

          const clientWrapper = this.clientWrappers.get(ws);
          if (clientWrapper) {
            this.clientWrappers.delete(ws);

            // emit 'close' on wrapper
            clientWrapper.emit('close', code);
          }
        },

      }
    });

    listeningListener?.();

    // Mocking Transport.server behaviour, https://github.com/colyseus/colyseus/issues/458
    // @ts-ignore
    this.server.emit("listening");

    return this;
  }

  public shutdown() {
    if (this.bunServer) {
      this.bunServer.stop(true);

      // @ts-ignore
      this.server.emit("close"); // Mocking Transport.server behaviour, https://github.com/colyseus/colyseus/issues/458
    }
  }

  public simulateLatency(milliseconds: number) {
    const originalRawSend = WebSocketClient.prototype.raw;
    WebSocketClient.prototype.raw = function () {
      setTimeout(() => originalRawSend.apply(this, arguments), milliseconds);
    }
  }

  protected async onConnection(rawClient: ServerWebSocket<WebSocketData>) {
    const wrapper = new WebSocketWrapper(rawClient);
    // keep reference to client and its wrapper
    this.clients.push(rawClient);
    this.clientWrappers.set(rawClient, wrapper);

    const parsedURL = new URL(rawClient.data.url);

    const sessionId = parsedURL.searchParams.get("sessionId");
    const processAndRoomId = parsedURL.pathname.match(/\/[a-zA-Z0-9_\-]+\/([a-zA-Z0-9_\-]+)$/);
    const roomId = processAndRoomId && processAndRoomId[1];

    const room = matchMaker.getRoomById(roomId);
    const client = new WebSocketClient(sessionId, wrapper);

    //
    // TODO: DRY code below with all transports
    //

    try {
      if (!room || !room.hasReservedSeat(sessionId, parsedURL.searchParams.get("reconnectionToken") as string)) {
        throw new Error('seat reservation expired.');
      }

      await room._onJoin(client, rawClient as unknown as http.IncomingMessage);

    } catch (e) {
      debugAndPrintError(e);

      // send error code to client then terminate
      client.error(e.code, e.message, () => rawClient.close());
    }
  }

  protected async handleMatchMakeRequest (req: Request, server: Server, url: URL): Promise<[number, string, { [key: string]: string }]> {
    switch (req.method) {
      case 'OPTIONS': return [200, undefined, {}];

      case 'GET': {
        const matchedParams = url.pathname.match(matchMaker.controller.allowedRoomNameChars);
        const roomName = matchedParams.length > 1 ? matchedParams[matchedParams.length - 1] : "";

        return [
          200,
          JSON.stringify(await matchMaker.controller.getAvailableRooms(roomName || '')), {
            'Content-Type': 'application/json'
          }
        ];
      }

      case 'POST': {
        // do not accept matchmaking requests if already shutting down
        if (matchMaker.isGracefullyShuttingDown) {
          throw new ServerError(503, "server is shutting down");
        }

        const matchedParams = url.pathname.match(matchMaker.controller.allowedRoomNameChars);
        const matchmakeIndex = matchedParams.indexOf(matchMaker.controller.matchmakeRoute);

        const clientOptions = Bun.readableStreamToJSON(req.body);

        if (clientOptions === undefined) {
          throw new Error("invalid JSON input");
        }

        const method = matchedParams[matchmakeIndex + 1];
        const roomName = matchedParams[matchmakeIndex + 2] || '';

        return [
          200,
          JSON.stringify(await matchMaker.controller.invokeMethod(method, roomName, clientOptions)), {
            'Content-Type': 'application/json'
          }
        ];
      }

      default: return undefined;
    }
  }

}

// <reference types="bun-types" />

// "bun-types" is currently conflicting with "ws" types.
// @ts-ignore
import { ServerWebSocket, WebSocketHandler } from 'bun';

import type http from 'http';
import bunExpress from 'bun-serve-express';
import type { Application, Request, Response } from "express";

import { HttpServerMock, matchMaker, Transport, debugAndPrintError, spliceOne, ServerError, getBearerToken } from '@colyseus/core';
import { WebSocketClient, WebSocketWrapper } from './WebSocketClient.js';

export type TransportOptions = Partial<Omit<WebSocketHandler, "message" | "open" | "drain" | "close" | "ping" | "pong">>;

interface WebSocketData {
  url: URL;
  headers: any;
}

export class BunWebSockets extends Transport {
  public expressApp: Application;

  protected clients: ServerWebSocket<WebSocketData>[] = [];
  protected clientWrappers = new WeakMap<ServerWebSocket<WebSocketData>, WebSocketWrapper>();

  private _listening: any;
  private _originalRawSend: typeof WebSocketClient.prototype.raw | null = null;

  constructor(private options: TransportOptions = {}) {
    super();

    const self = this;

    this.expressApp = bunExpress({
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

    // Adding a mock object for Transport.server
    if (!this.server) {
      // @ts-ignore
      this.server = new HttpServerMock();
    }
  }

  public listen(port: number, hostname?: string, backlog?: number, listeningListener?: () => void) {
    this._listening = this.expressApp.listen(port, listeningListener);

    this.expressApp.use(`/${matchMaker.controller.matchmakeRoute}`, async (req, res) => {
      try {
        await this.handleMatchMakeRequest(req, res);
      } catch (e) {
        res.status(500).json({
          code: e.code,
          error: e.message
        });
      }
    });

    // Mocking Transport.server behaviour, https://github.com/colyseus/colyseus/issues/458
    // @ts-ignore
    this.server.emit("listening");

    return this;
  }

  public shutdown() {
    if (this._listening) {
      this._listening.close();

      // @ts-ignore
      this.server.emit("close"); // Mocking Transport.server behaviour, https://github.com/colyseus/colyseus/issues/458
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
      setTimeout(() => originalRawSend.apply(this, [buf, ...rest]), milliseconds);
    };
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

    const room = matchMaker.getLocalRoomById(roomId);
    const client = new WebSocketClient(sessionId, wrapper);

    //
    // TODO: DRY code below with all transports
    //

    try {
      if (!room || !room.hasReservedSeat(sessionId, parsedURL.searchParams.get("reconnectionToken") as string)) {
        throw new Error('seat reservation expired.');
      }

      await room._onJoin(client, {
        token: parsedURL.searchParams.get("_authToken") ?? getBearerToken(rawClient.data.headers['authorization']),
        headers: rawClient.data.headers,
        ip: rawClient.data.headers['x-real-ip'] ?? rawClient.data.headers['x-forwarded-for'] ?? rawClient.remoteAddress,
      });

    } catch (e) {
      debugAndPrintError(e);

      // send error code to client then terminate
      client.error(e.code, e.message, () => rawClient.close());
    }
  }

  protected async handleMatchMakeRequest(req: Request, res: Response) {
    const writeHeaders = (req: Request, res: Response) => {
      if (res.destroyed) return;

      res.set(Object.assign(
        {},
        matchMaker.controller.DEFAULT_CORS_HEADERS,
        matchMaker.controller.getCorsHeaders.call(undefined, req)
      ));

      return true;
    };

    try {
      switch (req.method) {
        case 'OPTIONS': {
          writeHeaders(req, res);
          res.status(200).end();
          break;
        }

        case 'GET': {
          writeHeaders(req, res);
          res.status(404).end();
          break;
        }

        case 'POST': {
          // do not accept matchmaking requests if already shutting down
          if (matchMaker.state === matchMaker.MatchMakerState.SHUTTING_DOWN) {
            throw new ServerError(503, "server is shutting down");
          }

          const matchedParams = req.path.match(matchMaker.controller.allowedRoomNameChars);
          const matchmakeIndex = matchedParams.indexOf(matchMaker.controller.matchmakeRoute);
          let clientOptions = req.body; // Bun.readableStreamToJSON(req.body);

          if (clientOptions == null) {
            throw new ServerError(500, "invalid JSON input");
          }

          if (typeof clientOptions === 'string' && clientOptions.length > 2) {
            clientOptions = JSON.parse(clientOptions);
          } else if (typeof clientOptions !== 'object') {
            clientOptions = {};
          }

          const method = matchedParams[matchmakeIndex + 1];
          const roomName = matchedParams[matchmakeIndex + 2] || '';

          writeHeaders(req, res);
          res.json(await matchMaker.controller.invokeMethod(
            method,
            roomName,
            clientOptions,
            {
              token: getBearerToken(req.headers['authorization']),
              headers: req.headers,
              ip: req.headers['x-real-ip'] ?? req.headers['x-forwarded-for'] ?? req.ips,
            },
          ));
          break;
        }

        default: throw new ServerError(500, "invalid request method");
      }

    } catch (e) {
      writeHeaders(req, res);
      res.status(500)
        .json({ code: e.code, error: e.message });
    }
  }

}

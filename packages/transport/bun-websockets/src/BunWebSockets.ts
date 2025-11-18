// <reference types="bun-types" />

// "bun-types" is currently conflicting with "ws" types.
// @ts-ignore
import { ServerWebSocket, WebSocketHandler } from 'bun';

// import bunExpress from 'bun-serve-express';
import type { Application, Request, Response } from "express";

import { HttpServerMock, matchMaker, Transport, debugAndPrintError, spliceOne, ServerError, getBearerToken } from '@colyseus/core';
import { WebSocketClient, WebSocketWrapper } from './WebSocketClient.ts';

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
  private options: TransportOptions = {};

  constructor(options: TransportOptions = {}) {
    super();

    const self = this;

    this.options = options;

    // this.expressApp = bunExpress({
    //   websocket: {
    //     ...this.options,

    //     async open(ws) {
    //       await self.onConnection(ws);
    //     },

    //     message(ws, message) {
    //       self.clientWrappers.get(ws)?.emit('message', message);
    //     },

    //     close(ws, code, reason) {
    //       // remove from client list
    //       spliceOne(self.clients, self.clients.indexOf(ws));

    //       const clientWrapper = self.clientWrappers.get(ws);
    //       if (clientWrapper) {
    //         self.clientWrappers.delete(ws);

    //         // emit 'close' on wrapper
    //         clientWrapper.emit('close', code);
    //       }
    //     },
    //   }
    // });

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
        // TODO: use shared handler here
        // await this.handleMatchMakeRequest(req, res);
      } catch (e: any) {
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
      // @ts-ignore
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
    const reconnectionToken = parsedURL.searchParams.get("reconnectionToken");
    const skipHandshake = (parsedURL.searchParams.has("skipHandshake"));

    //
    // TODO: DRY code below with all transports
    //

    try {
      if (!room || !room.hasReservedSeat(sessionId, reconnectionToken)) {
        throw new Error('seat reservation expired.');
      }

      await room['_onJoin'](client, {
        token: parsedURL.searchParams.get("_authToken") ?? getBearerToken(rawClient.data.headers['authorization']),
        headers: rawClient.data.headers,
        ip: rawClient.data.headers['x-real-ip'] ?? rawClient.data.headers['x-forwarded-for'] ?? rawClient.remoteAddress,
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

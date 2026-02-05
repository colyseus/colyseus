import http from 'http';
import { URL } from 'url';
import WebSocket, { type ServerOptions, WebSocketServer } from 'ws';
import express from 'express';

import { matchMaker, Protocol, Transport, debugAndPrintError, debugConnection, getBearerToken, CloseCode, connectClientToRoom } from '@colyseus/core';
import { WebSocketClient } from './WebSocketClient.ts';

function noop() {}
function heartbeat(this: any) { this.pingCount = 0; }

type RawWebSocketClient = WebSocket & { pingCount: number };

export interface TransportOptions extends ServerOptions {
  pingInterval?: number;
  pingMaxRetries?: number;
}

export class WebSocketTransport extends Transport {
  protected wss: WebSocketServer;

  protected pingInterval: NodeJS.Timeout;
  protected pingIntervalMS: number;
  protected pingMaxRetries: number;

  private _originalSend: typeof WebSocketClient.prototype.raw | null = null;
  private _expressApp?: express.Application;

  constructor(options: TransportOptions = {}) {
    super();

    if (options.maxPayload === undefined) {
      options.maxPayload = 4 * 1024; // 4Kb
    }

    // disable per-message deflate by default
    if (options.perMessageDeflate === undefined) {
      options.perMessageDeflate = false;
    }

    this.pingIntervalMS = (options.pingInterval !== undefined)
      ? options.pingInterval
      : 3000;

    this.pingMaxRetries = (options.pingMaxRetries !== undefined)
      ? options.pingMaxRetries
      : 2;

    // create server by default
    if (!options.server && !options.noServer) {
      options.server = http.createServer();
    }

    this.wss = new WebSocketServer(options);
    this.wss.on('connection', this.onConnection);

    // this is required to allow the ECONNRESET error to trigger on the `server` instance.
    this.wss.on('error', (err) => debugAndPrintError(err));

    this.server = options.server;

    if (this.pingIntervalMS > 0 && this.pingMaxRetries > 0) {
      this.server.on('listening', () =>
        this.autoTerminateUnresponsiveClients(this.pingIntervalMS, this.pingMaxRetries));

      this.server.on('close', () =>
        clearInterval(this.pingInterval));
    }
  }

  public getExpressApp(): express.Application {
    if (!this._expressApp) {
      this._expressApp = express();
      this.server.on('request', this._expressApp);
    }
    return this._expressApp;
  }

  public listen(port: number, hostname?: string, backlog?: number, listeningListener?: () => void) {
    this.server.listen(port, hostname, backlog, listeningListener);
    return this;
  }

  public shutdown() {
    this.wss.close();
    this.server.close();
  }

  public simulateLatency(milliseconds: number) {
    if (this._originalSend == null) {
      this._originalSend = WebSocketClient.prototype.raw;
    }

    const originalSend = this._originalSend;

    WebSocketClient.prototype.raw = milliseconds <= Number.EPSILON ? originalSend : function (...args: any[]) {
      // copy buffer
      let [buf, ...rest] = args;
      buf = Array.from(buf);
      // @ts-ignore
      setTimeout(() => originalSend.apply(this, [buf, ...rest]), milliseconds);
    };
  }

  protected autoTerminateUnresponsiveClients(pingInterval: number, pingMaxRetries: number) {
    // interval to detect broken connections
    this.pingInterval = setInterval(() => {
      this.wss.clients.forEach((client: WebSocket) => {
        //
        // if client hasn't responded after the interval, terminate its connection.
        //
        if ((client as RawWebSocketClient).pingCount >= pingMaxRetries) {
          // debugConnection(`terminating unresponsive client ${client.sessionId}`);
          debugConnection(`terminating unresponsive client`);
          return client.terminate();
        }

        (client as RawWebSocketClient).pingCount++;
        client.ping(noop);
      });
    }, pingInterval);
  }

  protected async onConnection(rawClient: RawWebSocketClient, req: http.IncomingMessage) {
    // prevent server crashes if a single client had unexpected error
    rawClient.on('error', (err) => debugAndPrintError(err.message + '\n' + err.stack));
    rawClient.on('pong', heartbeat);
    rawClient.pingCount = 0;

    const parsedURL = new URL(`ws://server/${req.url}`);

    const sessionId = parsedURL.searchParams.get("sessionId");
    const processAndRoomId = parsedURL.pathname.match(/\/[a-zA-Z0-9_\-]+\/([a-zA-Z0-9_\-]+)$/);
    const roomId = processAndRoomId && processAndRoomId[1];

    // If sessionId is not provided, allow ping-pong utility.
    if (!sessionId && !roomId) {
      // Disconnect automatically after 1 second if no message is received.
      const timeout = setTimeout(() => rawClient.close(CloseCode.NORMAL_CLOSURE), 1000);
      rawClient.on('message', (_) => rawClient.send(new Uint8Array([Protocol.PING])));
      rawClient.on('close', () => clearTimeout(timeout));
      return;
    }

    const room = matchMaker.getLocalRoomById(roomId);

    const client = new WebSocketClient(sessionId, rawClient);
    const reconnectionToken = parsedURL.searchParams.get("reconnectionToken");
    const skipHandshake = (parsedURL.searchParams.has("skipHandshake"));

    try {
      await connectClientToRoom(room, client, {
        headers: new Headers(req.headers as Record<string, string>),
        token: parsedURL.searchParams.get("_authToken") ?? getBearerToken(req.headers.authorization),
        ip: req.headers['x-real-ip'] ?? req.headers['x-forwarded-for'] ?? req.socket.remoteAddress,
      }, {
        reconnectionToken,
        skipHandshake
      });

    } catch (e: any) {
      debugAndPrintError(e);

      // send error code to client then terminate
      client.error(e.code, e.message, () =>
        rawClient.close(reconnectionToken
          ? CloseCode.FAILED_TO_RECONNECT
          : CloseCode.WITH_ERROR));
    }
  }

}

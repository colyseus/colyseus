import http from 'http';
import querystring from 'querystring';
import url from 'url';
import WebSocket, { ServerOptions } from 'ws';

import { matchMaker, Protocol, Transport, debugAndPrintError, debugConnection } from '@colyseus/core';
import { WebSocketClient } from './WebSocketClient';

function noop() {/* tslint:disable:no-empty */ }
function heartbeat() { this.pingCount = 0; }

type RawWebSocketClient = WebSocket & { pingCount: number };

export interface TransportOptions extends ServerOptions {
  pingInterval?: number;
  pingMaxRetries?: number;
}

export class WebSocketTransport extends Transport {
  protected wss: WebSocket.Server;

  protected pingInterval: NodeJS.Timer;
  protected pingIntervalMS: number;
  protected pingMaxRetries: number;

  constructor(options: TransportOptions = {}) {
    super();

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

    this.wss = new WebSocket.Server(options);
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

  public listen(port: number, hostname?: string, backlog?: number, listeningListener?: () => void) {
    this.server.listen(port, hostname, backlog, listeningListener);
    return this;
  }

  public shutdown() {
    this.wss.close();
    this.server.close();
  }

  public simulateLatency(milliseconds: number) {
    const previousSend = WebSocket.prototype.send;
    WebSocket.prototype.send = function(...args: any[]) {
      setTimeout(() => previousSend.apply(this, args), milliseconds);
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

  protected async onConnection(rawClient: RawWebSocketClient, req?: http.IncomingMessage & any) {
    // prevent server crashes if a single client had unexpected error
    rawClient.on('error', (err) => debugAndPrintError(err.message + '\n' + err.stack));
    rawClient.on('pong', heartbeat);

    // compatibility with ws / uws
    const upgradeReq = req || (rawClient as any).upgradeReq;
    const parsedURL = url.parse(upgradeReq.url);

    const sessionId = querystring.parse(parsedURL.query).sessionId as string;
    const processAndRoomId = parsedURL.pathname.match(/\/[a-zA-Z0-9_\-]+\/([a-zA-Z0-9_\-]+)$/);
    const roomId = processAndRoomId && processAndRoomId[1];

    const room = matchMaker.getRoomById(roomId);

    // set client id
    rawClient.pingCount = 0;

    const client = new WebSocketClient(sessionId, rawClient);

    //
    // TODO: DRY code below with all transports
    //

    try {
      if (!room || !room.hasReservedSeat(sessionId)) {
        throw new Error('seat reservation expired.');
      }

      await room._onJoin(client, upgradeReq);

    } catch (e) {
      debugAndPrintError(e);

      // send error code to client then terminate
      client.error(e.code, e.message, () =>
        rawClient.close(Protocol.WS_CLOSE_WITH_ERROR));
    }
  }

}

import http from 'http';
import querystring from 'querystring';
import url from 'url';
import WebSocket from 'ws';

import * as matchMaker from '../../MatchMaker';
import { Protocol } from '../../Protocol';

import { ServerOptions } from '../../Server';
import { Transport } from '../Transport';

import { debugAndPrintError, debugConnection } from '../../Debug';
import { WebSocketClient } from './WebSocketClient';

function noop() {/* tslint:disable:no-empty */ }
function heartbeat() { this.pingCount = 0; }

type RawWebSocketClient = WebSocket & { pingCount: number };

export class WebSocketTransport extends Transport {
  protected wss: WebSocket.Server;

  protected pingInterval: NodeJS.Timer;
  protected pingIntervalMS: number;
  protected pingMaxRetries: number;

  constructor(options: ServerOptions = {}, engine: any) {
    super();

    // disable per-message deflate
    options.perMessageDeflate = false;

    if (options.pingTimeout !== undefined) {
      console.warn('"pingTimeout" is deprecated. Use "pingInterval" instead.');
      options.pingInterval = options.pingTimeout;
    }

    if (options.pingCountMax !== undefined) {
      console.warn('"pingCountMax" is deprecated. Use "pingMaxRetries" instead.');
      options.pingMaxRetries = options.pingCountMax;
    }

    this.pingIntervalMS = (options.pingInterval !== undefined)
      ? options.pingInterval
      : 1500;
    this.pingMaxRetries = (options.pingMaxRetries !== undefined)
      ? options.pingMaxRetries
      : 2;

    this.wss = new engine(options);
    this.wss.on('connection', this.onConnection);

    this.server = options.server;

    if (this.pingIntervalMS > 0 && this.pingMaxRetries > 0) {
      this.autoTerminateUnresponsiveClients(this.pingIntervalMS, this.pingMaxRetries);
    }
  }

  public listen(port: number, hostname?: string, backlog?: number, listeningListener?: () => void) {
    this.server.listen(port, hostname, backlog, listeningListener);
    return this;
  }

  public shutdown() {
    clearInterval(this.pingInterval);
    this.wss.close();
    this.server.close();
  }

  protected autoTerminateUnresponsiveClients(pingInterval: number, pingMaxRetries: number) {
    // interval to detect broken connections
    this.pingInterval = setInterval(() => {
      this.wss.clients.forEach((client: RawWebSocketClient) => {
        //
        // if client hasn't responded after the interval, terminate its connection.
        //
        if (client.pingCount >= pingMaxRetries) {
          // debugConnection(`terminating unresponsive client ${client.sessionId}`);
          debugConnection(`terminating unresponsive client`);
          return client.terminate();
        }

        client.pingCount++;
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

    try {
      if (!room || !room.hasReservedSeat(sessionId)) {
        throw new Error('seat reservation expired.');
      }

      await room._onJoin(client, upgradeReq);

    } catch (e) {
      debugAndPrintError(e);
      client.error(e.code, e.message);
      rawClient.close(Protocol.WS_CLOSE_WITH_ERROR);
    }
  }

}

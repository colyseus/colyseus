import http from 'http';
import url from 'url';
import WebSocket from 'ws';

import { Client, Protocol } from '..';

import { MatchMaker } from '../MatchMaker';
import { send } from '../Protocol';
import { parseQueryString } from '../Utils';
import { ServerOptions } from './../Server';
import { Transport } from './Transport';

import { debugAndPrintError } from './../Debug';

function noop() {/* tslint:disable:no-empty */ }
function heartbeat() { this.pingCount = 0; }

export class WebSocketTransport extends Transport {
  protected wss: WebSocket.Server;

  protected pingInterval: NodeJS.Timer;
  protected pingTimeout: number;

  constructor(matchMaker: MatchMaker, options: ServerOptions = {}, engine: any) {
    super(matchMaker);
    this.pingTimeout = (options.pingTimeout !== undefined)
      ? options.pingTimeout
      : 1500;

    this.wss = new engine(options);
    this.wss.on('connection', this.onConnection);

    this.server = options.server;

    if (this.pingTimeout > 0) {
      this.autoTerminateUnresponsiveClients(this.pingTimeout);
    }

    // interval to detect broken connections
    this.pingInterval = setInterval(() => {
      this.wss.clients.forEach((client: Client) => {
        //
        // if client hasn't responded after the interval, terminate its connection.
        //
        if (client.pingCount >= 2) {
          return client.terminate();
        }

        client.pingCount++;
        client.ping(noop);
      });
    }, this.pingTimeout);
  }

  public listen(port: number, hostname?: string, backlog?: number, listeningListener?: Function) {
    this.server.listen(port, hostname, backlog, listeningListener);
    return this;
  }

  public shutdown() {
    clearInterval(this.pingInterval);
    this.wss.close();
    this.server.close();
  }

  protected autoTerminateUnresponsiveClients(pingTimeout: number) {
    // interval to detect broken connections
    this.pingInterval = setInterval(() => {
      this.wss.clients.forEach((client: Client) => {
        //
        // if client hasn't responded after the interval, terminate its connection.
        //
        if (client.pingCount >= 2) {
          return client.terminate();
        }

        client.pingCount++;
        client.ping(noop);
      });
    }, pingTimeout);
  }

  protected onConnection = async (client: Client, req?: http.IncomingMessage & any) => {
    // prevent server crashes if a single client had unexpected error
    client.on('error', (err) => debugAndPrintError(err.message + '\n' + err.stack));
    client.on('pong', heartbeat);

    // compatibility with ws / uws
    const upgradeReq = req || client.upgradeReq;
    const parsedURL = url.parse(upgradeReq.url);

    const { sessionId } = parseQueryString(parsedURL.query);
    const processAndRoomId = parsedURL.pathname.match(/\/[a-zA-Z0-9_\-]+\/([a-zA-Z0-9_\-]+)$/);
    const roomId = processAndRoomId && processAndRoomId[1];

    const room = this.matchMaker.getRoomById(roomId);

    // set client id
    client.pingCount = 0;

    // set client options
    client.sessionId = sessionId;

    // TODO: handle re-connection differently?
    try {
      await room._onJoin(client, upgradeReq);

    } catch (e) {
      debugAndPrintError(e.stack || e);
      send[Protocol.JOIN_ERROR](client, (e && e.message) || '');
      client.close(Protocol.WS_CLOSE_WITH_ERROR);
    }
  }

}

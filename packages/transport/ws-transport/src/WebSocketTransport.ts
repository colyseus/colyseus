import http, { STATUS_CODES } from 'http';
import type { Duplex } from 'stream';
import { URL } from 'url';
import WebSocket, { type ServerOptions, WebSocketServer } from 'ws';
import express from 'express';

import { matchMaker, Protocol, Transport, type AuthContext, type BeforeUpgradeHandler, createAuthContext, debugAndPrintError, debugConnection, CloseCode, connectClientToRoom, runBeforeUpgrade, isDevMode } from '@colyseus/core';
import { WebSocketClient } from './WebSocketClient.ts';

function noop() {}
function heartbeat(this: any) { this.pingCount = 0; }

function destroyOnError(this: Duplex) { this.destroy(); }

async function writeResponse(socket: Duplex, response: Response) {
  const body = Buffer.from(await response.arrayBuffer());
  if (socket.destroyed) { return; }

  const head = [`HTTP/1.1 ${response.status} ${response.statusText || STATUS_CODES[response.status] || ''}`];
  response.headers.forEach((value, key) => {
    const name = key.toLowerCase();
    // skipped: both are written below, from what was actually serialized
    if (name !== 'content-length' && name !== 'connection') { head.push(`${key}: ${value}`); }
  });
  head.push(`Content-Length: ${body.byteLength}`, 'Connection: close', '', '');

  socket.end(Buffer.concat([Buffer.from(head.join('\r\n')), body]));
}

type RawWebSocketClient = WebSocket & { pingCount: number };

/**
 * Built at upgrade only when `beforeUpgrade` needs it, then handed to
 * onConnection so the work is never repeated. Without the option, nothing here
 * is built until onConnection actually needs it.
 */
type UpgradeInfo = { url: URL, context: AuthContext };

function parseUrl(req: http.IncomingMessage) {
  // the two-argument form costs an extra parse of the base
  return new URL(`ws://server${req.url ?? '/'}`);
}

function buildAuthContext(req: http.IncomingMessage, url: URL): AuthContext {
  return createAuthContext({
    headers: req.headers as Record<string, string | undefined>,
    token: url.searchParams.get('_authToken'),
    remoteAddress: req.socket.remoteAddress,
  });
}

export interface TransportOptions extends ServerOptions {
  pingInterval?: number;
  pingMaxRetries?: number;

  /**
   * Intercepts an incoming WebSocket upgrade request, before the handshake.
   * Return a `Response` to answer the request instead of upgrading it.
   */
  beforeUpgrade?: BeforeUpgradeHandler;
}

/**
 * Options for binding this transport to an existing HTTP server.
 *
 * This is primarily used by `colyseus/vite`, which shares Vite's dev HTTP server
 * and forwards only Colyseus websocket upgrade requests to this transport.
 */
export interface AttachToServerOptions {
  /**
   * Return `true` to let this transport handle the upgrade request.
   * Requests that return `false` are left for the host HTTP server.
   */
  filter?: (req: http.IncomingMessage) => boolean;
}

export class WebSocketTransport extends Transport {
  protected wss: WebSocketServer;

  protected pingInterval: NodeJS.Timeout;
  protected pingIntervalMS: number;
  protected pingMaxRetries: number;

  // False when sharing an external HTTP server, such as Vite's dev server.
  protected shouldShutdownServer: boolean = true;

  private _originalSend: typeof WebSocketClient.prototype.raw | null = null;
  private _expressApp?: express.Application;
  private _beforeUpgrade?: BeforeUpgradeHandler;

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

    // `noServer: true` lets callers attach later via `attachToServer()`.
    // `colyseus/vite` uses this to share the Vite dev server instead of creating a new one.
    if (!options.server && !options.noServer) {
      options.server = http.createServer();
    }

    this._beforeUpgrade = options.beforeUpgrade;

    // This transport always owns the 'upgrade' event: ws completes the handshake
    // straight from its own listener, leaving `beforeUpgrade` no chance to answer first.
    const { server, beforeUpgrade, ...wsOptions } = options;
    this.wss = new WebSocketServer({ ...wsOptions, noServer: true });
    this.wss.on('connection', this.onConnection);
    this.wss.on('error', (err) => debugAndPrintError(err));

    this.server = server;

    if (this.server) {
      this.listenForUpgrade(this.server);

      // this is required to allow the ECONNRESET error to trigger on the `server` instance.
      this.server.on('error', (err) => debugAndPrintError(err));
    }

    if (this.server && this.pingIntervalMS > 0 && this.pingMaxRetries > 0) {
      this.server.on('listening', () =>
        this.autoTerminateUnresponsiveClients(this.pingIntervalMS, this.pingMaxRetries));

      this.server.on('close', () =>
        clearInterval(this.pingInterval));
    }
  }

  public getExpressApp(): express.Application {
    if (!this.server) {
      throw new Error('WebSocketTransport is not attached to an HTTP server.');
    }

    if (!this._expressApp) {
      this._expressApp = express();
      this.server.on('request', this._expressApp);
    }
    return this._expressApp;
  }

  public listen(port: number, hostname?: string, backlog?: number, listeningListener?: () => void) {
    if (!this.server) {
      throw new Error('WebSocketTransport is not attached to an HTTP server.');
    }

    this.server.listen(port, hostname, backlog, listeningListener);
    return this;
  }

  /**
   * Attach this transport to an already-running HTTP server.
   *
   * `colyseus/vite` uses this in dev mode so Colyseus can reuse Vite's HTTP server
   * instead of creating and owning a separate one.
   */
  public attachToServer(server: http.Server, options: AttachToServerOptions = {}) {
    this.server = server;
    this.shouldShutdownServer = false;

    this.listenForUpgrade(server, options.filter);

    if (this.pingIntervalMS > 0 && this.pingMaxRetries > 0 && !this.pingInterval) {
      // An externally-managed server may already be listening, so start heartbeat here
      // instead of waiting for a future "listening" event.
      this.autoTerminateUnresponsiveClients(this.pingIntervalMS, this.pingMaxRetries);
      server.on('close', () => clearInterval(this.pingInterval));
    }

    return this;
  }

  /**
   * Close the websocket server and all active websocket connections.
   *
   * When attached through `attachToServer()`, keep the shared HTTP server alive.
   * This is required for `colyseus/vite`, which does not own the Vite dev server.
   */
  public shutdown() {
    this.wss.close();

    if (this.shouldShutdownServer) {
      this.server?.close();
    }
  }

  /**
   * Route the HTTP server's upgrade requests into this transport, running
   * `beforeUpgrade` (if any) before the handshake is completed.
   */
  protected listenForUpgrade(server: http.Server, filter?: (req: http.IncomingMessage) => boolean) {
    const completeUpgrade = (req: http.IncomingMessage, socket: Duplex, head: Buffer, upgrade?: UpgradeInfo) =>
      this.wss.handleUpgrade(req, socket as any, head, (ws) => this.wss.emit('connection', ws, req, upgrade));

    server.on('upgrade', (req, socket: Duplex, head) => {
      if (filter && !filter(req)) {
        return;
      }

      if (this._beforeUpgrade === undefined) {
        completeUpgrade(req, socket, head);
        return;
      }

      const url = parseUrl(req);
      const upgrade: UpgradeInfo = { url, context: buildAuthContext(req, url) };

      // the socket is unguarded until ws attaches its own handler in handleUpgrade()
      socket.on('error', destroyOnError);

      runBeforeUpgrade(this._beforeUpgrade, req.url ?? '/', upgrade.context).then((response) => {
        if (socket.destroyed) { return; }

        if (response !== undefined) {
          return writeResponse(socket, response); // keeps destroyOnError: it still awaits the body
        }

        socket.removeListener('error', destroyOnError);
        completeUpgrade(req, socket, head, upgrade);
      }).catch((e) => {
        debugAndPrintError(e);
        socket.destroy();
      });
    });
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

  protected async onConnection(rawClient: RawWebSocketClient, req: http.IncomingMessage, upgrade?: UpgradeInfo) {
    // prevent server crashes if a single client had unexpected error
    rawClient.on('error', (err) => debugAndPrintError(err.message + '\n' + err.stack));
    rawClient.on('pong', heartbeat);
    rawClient.pingCount = 0;

    const parsedURL = upgrade?.url ?? parseUrl(req);

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
      await connectClientToRoom(room, client, upgrade?.context ?? buildAuthContext(req, parsedURL), {
        reconnectionToken,
        skipHandshake
      });

    } catch (e: any) {
      debugAndPrintError(e);

      // send error code to client then terminate.
      // Use MAY_TRY_RECONNECT when a reconnection token is present so the
      // SDK retries — the seat may not be reserved yet during devMode HMR.
      client.error(e.code, e.message, () =>
        rawClient.close(reconnectionToken
          ? (isDevMode)
            ? CloseCode.MAY_TRY_RECONNECT 
            : CloseCode.FAILED_TO_RECONNECT
          : CloseCode.WITH_ERROR));
    }
  }

}

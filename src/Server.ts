import http, { IncomingMessage, ServerResponse } from 'http';
import net from 'net';
import WebSocket from 'ws';
import { ServerOptions as IServerOptions } from 'ws';

import { debugAndPrintError, debugMatchMaking } from './Debug';
import * as matchMaker from './MatchMaker';
import { RegisteredHandler } from './matchmaker/RegisteredHandler';
import { Presence } from './presence/Presence';
import { TCPTransport, Transport, WebSocketTransport } from './transport/Transport';

import { RoomConstructor } from './Room';
import { registerGracefulShutdown } from './Utils';

import { generateId } from '.';
import { registerNode, unregisterNode } from './discovery';
import { LocalPresence } from './presence/LocalPresence';

import { MatchMakeError } from './errors/MatchMakeError';
import { Protocol } from './Protocol';

export type ServerOptions = IServerOptions & {
  pingTimeout?: number,
  pingCountMax?: number,
  verifyClient?: WebSocket.VerifyClientCallbackAsync
  presence?: any,
  driver?: any,
  engine?: any,
  ws?: any,
  express?: any,
  gracefullyShutdown?: boolean,
};

export class Server {
  public transport: Transport;

  protected presence: Presence;
  protected processId: string = generateId();
  protected route = '/matchmake';

  private exposedMethods = ['joinOrCreate', 'create', 'join', 'joinById'];
  private allowedRoomNameChars = /([a-zA-Z_\-0-9]+)/gi;

  constructor(options: ServerOptions = {}) {
    const { gracefullyShutdown = true } = options;

    this.presence = options.presence || new LocalPresence();

    // setup matchmaker
    matchMaker.setup(this.presence, options.driver, this.processId);

    // "presence" option is not used from now on
    delete options.presence;

    this.attach(options);

    if (gracefullyShutdown) {
      registerGracefulShutdown((signal) => this.gracefullyShutdown());
    }
  }

  public attach(options: ServerOptions) {
    if (!options.server) { options.server = http.createServer(); }
    options.server.once('listening', () => this.registerProcessForDiscovery());

    this.attachMatchMakingRoutes(options.server);

    const engine = options.engine || WebSocket.Server;
    delete options.engine;

    this.transport = (engine === net.Server)
      ? new TCPTransport(options)
      : new WebSocketTransport(options, engine);
  }

  public listen(port: number, hostname?: string, backlog?: number, listeningListener?: Function) {
    this.transport.listen(port, hostname, backlog, listeningListener);
  }

  public registerProcessForDiscovery() {
    // register node for proxy/service discovery
    registerNode(this.presence, {
      port: this.transport.address().port,
      processId: this.processId,
    });
  }

  public define(name: string, handler: RoomConstructor, defaultOptions: any = {}): RegisteredHandler {
    return matchMaker.defineRoomType(name, handler, defaultOptions);
  }

  public async gracefullyShutdown(exit: boolean = true) {
    await unregisterNode(this.presence, {
      port: this.transport.address().port,
      processId: this.processId,
    });

    try {
      await matchMaker.gracefullyShutdown();
      this.transport.shutdown();
      await this.onShutdownCallback();

    } catch (e) {
      debugAndPrintError(`error during shutdown: ${e}`);

    } finally {
      if (exit) { process.exit(); }
    }
  }

  public onShutdown(callback: () => void | Promise<any>) {
    this.onShutdownCallback = callback;
  }

  protected onShutdownCallback: () => void | Promise<any> =
    () => Promise.resolve()

  protected attachMatchMakingRoutes(server: http.Server) {
    const listeners = server.listeners('request').slice(0);
    server.removeAllListeners('request');

    server.on('request', (req, res) => {
      if (req.url.indexOf('/matchmake') !== -1) {
        debugMatchMaking('received matchmake request: %s', req.url);
        this.handleMatchMakeRequest(req, res);

      } else {
        for (let i = 0, l = listeners.length; i < l; i++) {
          listeners[i].call(server, req, res);
        }
      }
    });
  }

  protected async handleMatchMakeRequest(req: IncomingMessage, res: ServerResponse) {
    const headers = {
      'Access-Control-Allow-Headers': 'Origin, X-Requested-With, Content-Type, Accept',
      'Access-Control-Allow-Methods': 'OPTIONS, POST, GET',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Max-Age': 2592000,
      // ...
    };

    if (req.method === 'OPTIONS') {
      res.writeHead(204, headers);
      res.end();

    } else if (req.method === 'POST') {
      const matchedParams = req.url.match(this.allowedRoomNameChars);
      const method = matchedParams[matchedParams.length - 2];
      const name = matchedParams[matchedParams.length - 1];

      const data = [];
      req.on('data', (chunk) => data.push(chunk));
      req.on('end', async () => {
        headers['Content-Type'] = 'application/json';
        res.writeHead(200, headers);

        const body = JSON.parse(Buffer.concat(data).toString());
        try {
          if (this.exposedMethods.indexOf(method) === -1) {
            throw new MatchMakeError(`invalid method "${method}"`, Protocol.ERR_MATCHMAKE_UNHANDLED);
          }

          const response = await matchMaker[method](name, body);
          res.write(JSON.stringify(response));

        } catch (e) {
          res.write(JSON.stringify({
            code: e.code || Protocol.ERR_MATCHMAKE_UNHANDLED,
            error: e.message,
          }));
        }

        res.end();
      });

    } else if (req.method === 'GET') {
      const matchedParams = req.url.match(this.allowedRoomNameChars);
      const roomName = matchedParams[matchedParams.length - 1];

      /**
       * list public & unlocked rooms
       */
      const conditions: any = {
        locked: false,
        private: false,
      };

      // TODO: improve me, "matchmake" room names aren't allowed this way.
      if (roomName !== 'matchmake') {
        conditions.name = roomName;
      }

      headers['Content-Type'] = 'application/json';
      res.writeHead(200, headers);
      res.write(JSON.stringify(await matchMaker.query(conditions)));
      res.end();
    }

  }

}

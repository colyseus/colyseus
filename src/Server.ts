import http, { IncomingMessage, ServerResponse } from 'http';
import net from 'net';
import WebSocket from 'ws';
import { ServerOptions as IServerOptions } from 'ws';

import { debugAndPrintError, debugMatchMaking } from './Debug';
import * as matchMaker from './MatchMaker';
import { RegisteredHandler } from './matchmaker/RegisteredHandler';
import { Presence } from './presence/Presence';

import { Room } from './Room';
import { Type } from './types';
import { registerGracefulShutdown } from './Utils';

import { generateId } from '.';
import { registerNode, unregisterNode } from './discovery';
import { LocalPresence } from './presence/LocalPresence';

import { ServerError } from './errors/ServerError';
import { ErrorCode, Protocol } from './Protocol';
import { Transport } from './transport/Transport';

import { TCPTransport } from './transport/TCP/TCPTransport';
import { WebSocketTransport } from './transport/WebSocket/WebSocketTransport';

export type ServerOptions = IServerOptions & {
  pingInterval?: number,
  pingMaxRetries?: number,

  /**
   * @deprecated use `pingInterval` instead
   */
  pingTimeout?: number,

  /**
   * @deprecated use `pingMaxRetries` instead
   */
  pingCountMax?: number,

  /**
   * @deprecated remove on version 0.12.x
   */
  express?: any,

  verifyClient?: WebSocket.VerifyClientCallbackAsync
  presence?: Presence,
  driver?: matchMaker.MatchMakerDriver,
  engine?: any,
  ws?: any,
  gracefullyShutdown?: boolean,
};

export class Server {
  public transport: Transport;

  protected presence: Presence;
  protected processId: string = generateId();
  protected matchmakeRoute = 'matchmake';

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
      registerGracefulShutdown((err) => this.gracefullyShutdown(true, err));
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

  /**
   * Bind the server into the port specified.
   *
   * @param port
   * @param hostname
   * @param backlog
   * @param listeningListener
   */
  public async listen(port: number, hostname?: string, backlog?: number, listeningListener?: Function) {
    return new Promise<void>((resolve, reject) => {
      this.transport.server.on('error', (err) => reject(err));
      this.transport.listen(port, hostname, backlog, (err) => {
        if (listeningListener) {
          listeningListener(err);
        }

        if (err) {
          reject(err);

        } else {
          resolve();
        }
      });
    });
  }

  public registerProcessForDiscovery() {
    // register node for proxy/service discovery
    registerNode(this.presence, {
      port: this.transport.address().port,
      processId: this.processId,
    });
  }

  /**
   * Define a new type of room for matchmaking.
   *
   * @param name public room identifier for match-making.
   * @param handler Room class definition
   * @param defaultOptions default options for `onCreate`
   */
  public define<T extends Type<Room>>(
    name: string,
    handler: T,
    defaultOptions?: Parameters<NonNullable<InstanceType<T>['onCreate']>>[0],
  ): RegisteredHandler {
    return matchMaker.defineRoomType(name, handler, defaultOptions);
  }

  public async gracefullyShutdown(exit: boolean = true, err?: Error) {
    await unregisterNode(this.presence, {
      port: this.transport.address()?.port,
      processId: this.processId,
    });

    try {
      await matchMaker.gracefullyShutdown();
      this.transport.shutdown();
      await this.onShutdownCallback();

    } catch (e) {
      debugAndPrintError(`error during shutdown: ${e}`);

    } finally {
      if (exit) {
        process.exit(err ? 1 : 0);
      }
    }
  }

  /**
   * Add simulated latency between client and server.
   * @param milliseconds round trip latency in milliseconds.
   */
  public simulateLatency(milliseconds: number) {
    console.warn(`Colyseus latency simulation enabled → ${milliseconds}ms latency for round trip.`);

    const halfwayMS = (milliseconds / 2);
    this.transport.simulateLatency(halfwayMS);

    /* tslint:disable:no-string-literal */
    const _onMessage = Room.prototype['_onMessage'];
    /* tslint:disable:no-string-literal */
    Room.prototype['_onMessage'] = function(...args: any[]) {
      setTimeout(() => _onMessage.apply(this, args), halfwayMS);
    };
  }

  /**
   * Register a callback that is going to be executed before the server shuts down.
   * @param callback
   */
  public onShutdown(callback: () => void | Promise<any>) {
    this.onShutdownCallback = callback;
  }

  protected onShutdownCallback: () => void | Promise<any> =
    () => Promise.resolve()

  protected attachMatchMakingRoutes(server: http.Server) {
    const listeners = server.listeners('request').slice(0);
    server.removeAllListeners('request');

    server.on('request', (req, res) => {
      if (req.url.indexOf(`/${this.matchmakeRoute}`) !== -1) {
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
      const matchmakeIndex = matchedParams.indexOf(this.matchmakeRoute);
      const method = matchedParams[matchmakeIndex + 1];
      const name = matchedParams[matchmakeIndex + 2] || '';

      const data = [];
      req.on('data', (chunk) => data.push(chunk));
      req.on('end', async () => {
        headers['Content-Type'] = 'application/json';
        res.writeHead(200, headers);

        const body = JSON.parse(Buffer.concat(data).toString());
        try {
          if (this.exposedMethods.indexOf(method) === -1) {
            throw new ServerError(ErrorCode.MATCHMAKE_NO_HANDLER, `invalid method "${method}"`);
          }

          const response = await matchMaker[method](name, body);
          res.write(JSON.stringify(response));

        } catch (e) {
          res.write(JSON.stringify({
            code: e.code || ErrorCode.MATCHMAKE_UNHANDLED,
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
      if (roomName !== this.matchmakeRoute) {
        conditions.name = roomName;
      }

      headers['Content-Type'] = 'application/json';
      res.writeHead(200, headers);
      res.write(JSON.stringify(await matchMaker.query(conditions)));
      res.end();
    }

  }

}

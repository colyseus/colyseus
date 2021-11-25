import http, { IncomingMessage, ServerResponse } from 'http';

import { debugAndPrintError, debugMatchMaking } from './Debug';
import * as matchMaker from './MatchMaker';
import { RegisteredHandler } from './matchmaker/RegisteredHandler';
import { Presence } from './presence/Presence';

import { Room } from './Room';
import { Type } from './types';
import { registerGracefulShutdown } from './Utils';

import {generateId} from '.';
import { registerNode, unregisterNode } from './discovery';

import { LocalPresence } from './presence/LocalPresence';
import { LocalDriver } from './matchmaker/driver';

import { Transport } from './Transport';
import { logger, setLogger } from './Logger';

// IServerOptions &
export type ServerOptions = {
  publicAddress?: string,

  presence?: Presence,
  driver?: matchMaker.MatchMakerDriver,
  transport?: Transport,
  gracefullyShutdown?: boolean,
  logger?: any;

  /**
   * Options below are now part of WebSocketTransport (@colyseus/ws-transport)
   * TODO: remove me on 0.15.0
   */
  /** @deprecated */
  pingInterval?: number,

  /** @deprecated */
  pingMaxRetries?: number,

  /** @deprecated */
  verifyClient?: any,

  /** @deprecated */
  server?: http.Server,
};

export class Server {
  public transport: Transport;

  protected presence: Presence;
  protected driver: matchMaker.MatchMakerDriver;
  protected processId: string = generateId();

  protected port: number;

  constructor(options: ServerOptions = {}) {
    const { gracefullyShutdown = true } = options;

    this.presence = options.presence || new LocalPresence();
    this.driver = options.driver || new LocalDriver();

    // "presence" option is not used from now on
    delete options.presence;
    this.attach(options);

    // setup matchmaker
    matchMaker.setup(
      this.presence,
      this.driver,
      this.processId,
      options.publicAddress,
    );

    if (gracefullyShutdown) {
      registerGracefulShutdown((err) => this.gracefullyShutdown(true, err));
    }

    if(options.logger) {
      setLogger(options.logger);
    }
  }

  public attach(options: ServerOptions) {
    /**
     * Display deprecation warnings for moved Transport options.
     * TODO: Remove me on 0.15
     */
    if (
      options.pingInterval !== undefined ||
      options.pingMaxRetries !== undefined ||
      options.server !== undefined ||
      options.verifyClient !== undefined
    ) {
      logger.warn("DEPRECATION WARNING: 'pingInterval', 'pingMaxRetries', 'server', and 'verifyClient' Server options will be permanently moved to WebSocketTransport on v0.15");
      logger.warn(`new Server({
  transport: new WebSocketTransport({
    pingInterval: ...,
    pingMaxRetries: ...,
    server: ...,
    verifyClient: ...
  })
})`);
      logger.warn("👉 Documentation: https://docs.colyseus.io/server/transport/")
    }

    const transport = options.transport || this.getDefaultTransport(options);
    delete options.transport;

    this.transport = transport;

    if (this.transport.server) {
      this.transport.server.once('listening', () => this.registerProcessForDiscovery());
      this.attachMatchMakingRoutes(this.transport.server as http.Server);
    }
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
    this.port = port;

    return new Promise<void>((resolve, reject) => {
      this.transport.server?.on('error', (err) => reject(err));
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

  public async registerProcessForDiscovery() {
    // register node for proxy/service discovery
    registerNode(this.presence, {
      port: this.port,
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
      port: this.port,
      processId: this.processId,
    });

    try {
      await matchMaker.gracefullyShutdown();

      this.transport.shutdown();
      this.presence.shutdown();
      this.driver.shutdown();

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
    logger.warn(`📶️❗ Colyseus latency simulation enabled → ${milliseconds}ms latency for round trip.`);

    const halfwayMS = (milliseconds / 2);
    this.transport.simulateLatency(halfwayMS);

    /* tslint:disable:no-string-literal */
    const _onMessage = Room.prototype['_onMessage'];
    /* tslint:disable:no-string-literal */
    Room.prototype['_onMessage'] = function (client, buffer) {
      // uWebSockets.js: duplicate buffer because it is cleared at native layer before the timeout.
      const cachedBuffer = Buffer.from(buffer);
      setTimeout(() => _onMessage.call(this, client, cachedBuffer), halfwayMS);
    };
  }

  /**
   * Register a callback that is going to be executed before the server shuts down.
   * @param callback
   */
  public onShutdown(callback: () => void | Promise<any>) {
    this.onShutdownCallback = callback;
  }

  protected getDefaultTransport(_: any): Transport {
    throw new Error("Please provide a 'transport' layer. Default transport not set.");
  }

  protected onShutdownCallback: () => void | Promise<any> =
    () => Promise.resolve()

  protected attachMatchMakingRoutes(server: http.Server) {
    const listeners = server.listeners('request').slice(0);
    server.removeAllListeners('request');

    server.on('request', (req, res) => {
      if (req.url.indexOf(`/${matchMaker.controller.matchmakeRoute}`) !== -1) {
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
      const matchedParams = req.url.match(matchMaker.controller.allowedRoomNameChars);
      const matchmakeIndex = matchedParams.indexOf(matchMaker.controller.matchmakeRoute);
      const method = matchedParams[matchmakeIndex + 1];
      const roomName = matchedParams[matchmakeIndex + 2] || '';

      const data = [];
      req.on('data', (chunk) => data.push(chunk));
      req.on('end', async () => {
        headers['Content-Type'] = 'application/json';
        res.writeHead(200, headers);

        const clientOptions = JSON.parse(Buffer.concat(data).toString());
        try {
          const response = await matchMaker.controller.invokeMethod(method, roomName, clientOptions);
          res.write(JSON.stringify(response));

        } catch (e) {
          res.write(JSON.stringify({ code: e.code, error: e.message, }));
        }

        res.end();
      });

    } else if (req.method === 'GET') {
      const matchedParams = req.url.match(matchMaker.controller.allowedRoomNameChars);
      const roomName = matchedParams.length > 1 ? matchedParams[matchedParams.length - 1] : "";

      headers['Content-Type'] = 'application/json';
      res.writeHead(200, headers);
      res.write(JSON.stringify(await matchMaker.controller.getAvailableRooms(roomName)));
      res.end();
    }

  }

}

import http, { IncomingMessage, ServerResponse } from 'http';
import greeting from "@colyseus/greeting-banner";

import { debugAndPrintError, debugMatchMaking } from './Debug.js';
import * as matchMaker from './MatchMaker.js';
import { RegisteredHandler } from './matchmaker/RegisteredHandler.js';
import { Presence } from './presence/Presence.js';

import { Room } from './Room.js';
import { Type } from './utils/types.js';
import { getBearerToken, registerGracefulShutdown } from './utils/Utils.js';

import { registerNode, unregisterNode} from './discovery/index.js';

import { LocalPresence } from './presence/LocalPresence.js';
import { LocalDriver } from './matchmaker/driver/local/LocalDriver.js';

import { Transport } from './Transport.js';
import { logger, setLogger } from './Logger.js';
import { setDevMode, isDevMode } from './utils/DevMode.js';

export type ServerOptions = {
  publicAddress?: string,
  presence?: Presence,
  driver?: matchMaker.MatchMakerDriver,
  transport?: Transport,
  gracefullyShutdown?: boolean,
  logger?: any;

  /**
   * Custom function to determine which process should handle room creation.
   * Default: assign new rooms the process with least amount of rooms created
   */
  selectProcessIdToCreateRoom?: matchMaker.SelectProcessIdCallback;

  /**
   * If enabled, rooms are going to be restored in the server-side upon restart,
   * clients are going to automatically re-connect when server reboots.
   *
   * Beware of "schema mismatch" issues. When updating Schema structures and
   * reloading existing data, you may see "schema mismatch" errors in the
   * client-side.
   *
   * (This operation is costly and should not be used in a production
   * environment)
   */
  devMode?: boolean,

  /**
   * Display greeting message on server start.
   * Default: true
   */
  greet?: boolean,

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

  protected port: number;
  protected greet: boolean;

  //@ts-expect-error
  private _originalRoomOnMessage: typeof Room.prototype._onMessage | null = null;

  constructor(options: ServerOptions = {}) {
    const { gracefullyShutdown = true, greet = true } = options;

    setDevMode(options.devMode === true);

    this.presence = options.presence || new LocalPresence();
    this.driver = options.driver || new LocalDriver();
    this.greet = greet;

    this.attach(options);

    matchMaker.setup(
      this.presence,
      this.driver,
      options.publicAddress,
      options.selectProcessIdToCreateRoom,
    );

    if (gracefullyShutdown) {
      registerGracefulShutdown((err) => this.gracefullyShutdown(true, err));
    }

    if (options.logger) {
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
      // @ts-ignore
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

    //
    // Make sure matchmaker is ready before accepting connections
    // (isDevMode: matchmaker may take extra milliseconds to restore the rooms)
    //
    await matchMaker.accept();

    /**
     * Greetings!
     */
    if (this.greet) {
      console.log(greeting);
    }

    return new Promise<void>((resolve, reject) => {
      // @ts-ignore
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
    await registerNode(this.presence, {
      port: this.port,
      processId: matchMaker.processId,
    });
  }

  /**
   * Define a new type of room for matchmaking.
   *
   * @param name public room identifier for match-making.
   * @param roomClass Room class definition
   * @param defaultOptions default options for `onCreate`
   */
  public define<T extends Type<Room>>(
    roomClass: T,
    defaultOptions?: Parameters<NonNullable<InstanceType<T>['onCreate']>>[0],
  ): RegisteredHandler
  public define<T extends Type<Room>>(
    name: string,
    roomClass: T,
    defaultOptions?: Parameters<NonNullable<InstanceType<T>['onCreate']>>[0],
  ): RegisteredHandler
  public define<T extends Type<Room>>(
    nameOrHandler: string | T,
    handlerOrOptions: T | Parameters<NonNullable<InstanceType<T>['onCreate']>>[0],
    defaultOptions?: Parameters<NonNullable<InstanceType<T>['onCreate']>>[0],
  ): RegisteredHandler {
    const name = (typeof(nameOrHandler) === "string")
      ? nameOrHandler
      : nameOrHandler.name;

    const roomClass = (typeof(nameOrHandler) === "string")
      ? handlerOrOptions
      : nameOrHandler;

    const options = (typeof(nameOrHandler) === "string")
      ? defaultOptions
      : handlerOrOptions;

    return matchMaker.defineRoomType(name, roomClass, options);
  }

  /**
   * Remove a room definition from matchmaking.
   * This method does not destroy any room. It only dissallows matchmaking
   */
  public removeRoomType(name: string): void {
    matchMaker.removeRoomType(name);
  }

  public async gracefullyShutdown(exit: boolean = true, err?: Error) {
    if (matchMaker.state === matchMaker.MatchMakerState.SHUTTING_DOWN) {
      return;
    }

    await unregisterNode(this.presence, {
      port: this.port,
      processId: matchMaker.processId,
    });

    try {
      // custom "before shutdown" method
      await this.onBeforeShutdownCallback();

      await matchMaker.gracefullyShutdown();
      this.transport.shutdown();
      this.presence.shutdown();
      this.driver.shutdown();

      // custom "after shutdown" method
      await this.onShutdownCallback();

    } catch (e) {
      debugAndPrintError(`error during shutdown: ${e}`);

    } finally {
      if (exit) {
        process.exit((err && !isDevMode) ? 1 : 0);
      }
    }
  }

  /**
   * Add simulated latency between client and server.
   * @param milliseconds round trip latency in milliseconds.
   */
  public simulateLatency(milliseconds: number) {
    if (milliseconds > 0) {
      logger.warn(`📶️❗ Colyseus latency simulation enabled → ${milliseconds}ms latency for round trip.`);
    } else {
      logger.warn(`📶️❗ Colyseus latency simulation disabled.`);
    }

    const halfwayMS = (milliseconds / 2);
    this.transport.simulateLatency(halfwayMS);

    if (this._originalRoomOnMessage == null) {
      /* tslint:disable:no-string-literal */
      this._originalRoomOnMessage = Room.prototype['_onMessage'];
    }

    const originalOnMessage = this._originalRoomOnMessage;

    /* tslint:disable:no-string-literal */
    Room.prototype['_onMessage'] = milliseconds <= Number.EPSILON ? originalOnMessage : function (client, buffer) {
      // uWebSockets.js: duplicate buffer because it is cleared at native layer before the timeout.
      const cachedBuffer = Buffer.from(buffer);
      setTimeout(() => originalOnMessage.call(this, client, cachedBuffer), halfwayMS);
    };
  }

  /**
   * Register a callback that is going to be executed before the server shuts down.
   * @param callback
   */
  public onShutdown(callback: () => void | Promise<any>) {
    this.onShutdownCallback = callback;
  }

  public onBeforeShutdown(callback: () => void | Promise<any>) {
    this.onBeforeShutdownCallback = callback;
  }

  protected getDefaultTransport(_: any): Transport {
    throw new Error("Please provide a 'transport' layer. Default transport not set.");
  }

  protected onShutdownCallback: () => void | Promise<any> =
    () => Promise.resolve()

  protected onBeforeShutdownCallback: () => void | Promise<any> =
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
    // do not accept matchmaking requests if already shutting down
    if (matchMaker.state === matchMaker.MatchMakerState.SHUTTING_DOWN) {
      res.writeHead(503, {});
      res.end();
      return;
    }

    const headers = Object.assign(
      {},
      matchMaker.controller.DEFAULT_CORS_HEADERS,
      matchMaker.controller.getCorsHeaders.call(undefined, req)
    );

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

        try {
          const clientOptions = JSON.parse(Buffer.concat(data).toString());
          const response = await matchMaker.controller.invokeMethod(
            method,
            roomName,
            clientOptions,
            {
              token: getBearerToken(req.headers['authorization']),
              headers: req.headers,
              ip: req.headers['x-real-ip'] ?? req.headers['x-forwarded-for'] ?? req.socket.remoteAddress,
              req,
            },
          );

          // specify protocol, if available.
          if (this.transport.protocol !== undefined) {
            response.protocol = this.transport.protocol;
          }

          res.write(JSON.stringify(response));

        } catch (e) {
          res.write(JSON.stringify({ code: e.code, error: e.message, }));
        }

        res.end();
      });

    } else if (req.method === 'GET') {
      res.writeHead(404, headers);
      res.end();
    }

  }


}

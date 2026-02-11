import { greet } from "@colyseus/greeting-banner";
import type express from 'express';

import { debugAndPrintError } from './Debug.ts';
import * as matchMaker from './MatchMaker.ts';
import { RegisteredHandler } from './matchmaker/RegisteredHandler.ts';

import { type OnCreateOptions, Room } from './Room.ts';
import { Deferred, registerGracefulShutdown, dynamicImport, type Type } from './utils/Utils.ts';

import type { Presence } from "./presence/Presence.ts";
import { LocalPresence } from './presence/LocalPresence.ts';
import { LocalDriver } from './matchmaker/LocalDriver/LocalDriver.ts';

import { setTransport, Transport } from './Transport.ts';
import { logger, setLogger } from './Logger.ts';
import { setDevMode, isDevMode } from './utils/DevMode.ts';
import { type Router, bindRouterToTransport } from './router/index.ts';
import { type SDKTypes as SharedSDKTypes } from '@colyseus/shared-types';
import { getDefaultRouter } from './router/default_routes.ts';

export type ServerOptions = {
  publicAddress?: string,
  presence?: Presence,
  driver?: matchMaker.MatchMakerDriver,
  transport?: Transport,
  gracefullyShutdown?: boolean,
  logger?: any;

  /**
   * Optional callback to execute before the server listens.
   * This is useful for example to connect into a database or other services before the server listens.
   */
  beforeListen?: () => Promise<void> | void,

  /**
   * Optional callback to configure Express routes.
   * When provided, the transport layer will initialize an Express-compatible app
   * and pass it to this callback for custom route configuration.
   *
   * For uWebSockets transport, this uses the uwebsockets-express module.
   */
  express?: (app: express.Application) => void,

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
};

/**
 * Exposed types for the client-side SDK.
 * Re-exported from @colyseus/shared-types with specific type constraints.
 */
export interface SDKTypes<
  RoomTypes extends Record<string, RegisteredHandler> = any,
  Routes extends Router = any
> extends SharedSDKTypes<RoomTypes, Routes> {}

export class Server<
  RoomTypes extends Record<string, RegisteredHandler> = any,
  Routes extends Router = any
> implements SDKTypes<RoomTypes, Routes> {
  '~rooms': RoomTypes;
  '~routes': Routes;

  public transport: Transport;
  public router: Routes;
  public options: ServerOptions;

  protected presence: Presence;
  protected driver: matchMaker.MatchMakerDriver;

  protected port: number | string;
  protected greet: boolean;

  protected _onTransportReady = new Deferred<Transport>();

  private _originalRoomOnMessage: typeof Room.prototype['_onMessage'] | null = null;

  constructor(options: ServerOptions = {}) {
    const {
      gracefullyShutdown = true,
      greet = true
    } = options;

    setDevMode(options.devMode === true);

    this.presence = options.presence || new LocalPresence();
    this.driver = options.driver || new LocalDriver();
    this.options = options;
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

  public async attach(options: ServerOptions) {
    this.transport = options.transport || await this.getDefaultTransport(options);

    // Initialize Express if callback is provided
    if (options.express && this.transport.getExpressApp) {
      const expressApp = await this.transport.getExpressApp();
      options.express(expressApp);
    }

    // Resolve the promise when the transport is ready
    this._onTransportReady.resolve(this.transport);
  }

  /**
   * Bind the server into the port specified.
   *
   * @param port - Port number or Unix socket path
   * @param hostname
   * @param backlog
   * @param listeningListener
   */
  public async listen(port: number | string, hostname?: string, backlog?: number, listeningListener?: Function) {
    if (this.options.beforeListen) {
      await this.options.beforeListen();
    }

    //
    // if Colyseus Cloud is detected, use @colyseus/tools to listen
    //
    if (process.env.COLYSEUS_CLOUD !== undefined ) {
      if (typeof(hostname) === "number") {
        //
        // workaround, @colyseus/tools calls server.listen() again with the port as a string
        //
        hostname = undefined;

      } else {
        try {
          return (await dynamicImport("@colyseus/tools")).listen(this);
        } catch (error) {
          const err = new Error("Please install @colyseus/tools to be able to host on Colyseus Cloud.");
          err.cause = error;
          throw err;
        }
      }
    }

    //
    // otherwise, listen on the port directly
    //
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
      greet();
    }

    // Wait for the transport to be ready
    await this._onTransportReady;

    return new Promise<void>((resolve, reject) => {
      // TODO: refactor me!
      // set transport globally, to be used by matchmaking route
      setTransport(this.transport);

      this.transport.listen(port, hostname, backlog, (err) => {
        if (this.transport.server) {
          this.transport.server.on('error', (err) => reject(err));
        }

        // default router is used if no router is provided
        if (!this.router) {
          this.router = getDefaultRouter() as unknown as Routes;

        } else {
          // make sure default routes are included
          // https://github.com/Bekacru/better-call/pull/67
          this.router = this.router.extend({ ...getDefaultRouter().endpoints }) as unknown as Routes;
        }

        bindRouterToTransport(this.transport, this.router, this.options.express !== undefined);

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

  /**
   * Define a new type of room for matchmaking.
   *
   * @param name public room identifier for match-making.
   * @param roomClass Room class definition
   * @param defaultOptions default options for `onCreate`
   */
  public define<T extends Type<Room>>(
    roomClass: T,
    defaultOptions?: OnCreateOptions<T>,
  ): RegisteredHandler
  public define<T extends Type<Room>>(
    name: string,
    roomClass: T,
    defaultOptions?: OnCreateOptions<T>,
  ): RegisteredHandler
  public define<T extends Type<Room>>(
    nameOrHandler: string | T,
    handlerOrOptions: T | OnCreateOptions<T>,
    defaultOptions?: OnCreateOptions<T>,
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

    try {
      // custom "before shutdown" method
      await this.onBeforeShutdownCallback();

      // this is going to lock all rooms and wait for them to be disposed
      await matchMaker.gracefullyShutdown();

      this.transport.shutdown();
      this.presence.shutdown();
      await this.driver.shutdown();

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
      this._originalRoomOnMessage = Room.prototype['_onMessage'];
    }

    const originalOnMessage = this._originalRoomOnMessage;

    Room.prototype['_onMessage'] = milliseconds <= Number.EPSILON ? originalOnMessage : function (this: Room, client, buffer) {
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

  protected async getDefaultTransport(options: any): Promise<Transport> {
    try {
      const module = await dynamicImport('@colyseus/ws-transport');
      const WebSocketTransport = module.WebSocketTransport;
      return new WebSocketTransport(options);

    } catch (error) {
      this._onTransportReady.reject(error);
      throw new Error("Please provide a 'transport' layer. Default transport not set.");
    }
  }

  protected onShutdownCallback: () => void | Promise<any> =
    () => Promise.resolve()

  protected onBeforeShutdownCallback: () => void | Promise<any> =
    () => Promise.resolve()
}

export type DefineServerOptions<
  T extends Record<string, RegisteredHandler>,
  R extends Router
> = ServerOptions & {
  rooms: T,
  routes?: R,
};

export function defineServer<
  T extends Record<string, RegisteredHandler>,
  R extends Router
>(
  options: DefineServerOptions<T, R>,
): Server<T, R> {
  const { rooms, routes, ...serverOptions } = options;
  const server = new Server<T, R>(serverOptions);

  server.router = routes;

  for (const [name, handler] of Object.entries(rooms)) {
    handler.name = name;
    matchMaker.addRoomType(handler);
  }

  return server;
}

export function defineRoom<T extends Type<Room>>(
  roomKlass: T,
  defaultOptions?: Parameters<NonNullable<InstanceType<T>['onCreate']>>[0],
): RegisteredHandler<InstanceType<T>> {
  return new RegisteredHandler(roomKlass, defaultOptions) as unknown as RegisteredHandler<InstanceType<T>>;
}
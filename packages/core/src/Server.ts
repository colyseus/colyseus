import greeting from "@colyseus/greeting-banner";

import { debugAndPrintError } from './Debug.ts';
import * as matchMaker from './MatchMaker.ts';
import { RegisteredHandler } from './matchmaker/RegisteredHandler.ts';

import type { Presence } from './presence/Presence.ts';
import type { Type } from './utils/types.ts';

import { Room } from './Room.ts';
import { registerGracefulShutdown } from './utils/Utils.ts';

import { LocalPresence } from './presence/LocalPresence.ts';
import { LocalDriver } from './matchmaker/driver/local/LocalDriver.ts';

import { Transport } from './Transport.ts';
import { logger, setLogger } from './Logger.ts';
import { setDevMode, isDevMode } from './utils/DevMode.ts';
import { toNodeHandler, createRouter, type Router } from './router/index.ts';
import { getDefaultRouter } from "./matchmaker/routes.ts";

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
};

export class Server<
  RoomTypes extends Record<string, RegisteredHandler> = any,
  Routes extends Router = any
> {
  '~rooms': RoomTypes;
  '~routes': Routes;

  public transport: Transport;
  public router: Routes;

  protected presence: Presence;
  protected driver: matchMaker.MatchMakerDriver;

  protected port: number;
  protected greet: boolean;

  //@ts-expect-error
  private _originalRoomOnMessage: typeof Room.prototype._onMessage | null = null;

  constructor(options: ServerOptions = {}) {
    const {
      gracefullyShutdown = true,
      greet = true
    } = options;

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
    this.transport = options.transport || this.getDefaultTransport(options);
    delete options.transport;
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
      this.transport.listen(port, hostname, backlog, (err) => {
        const server = this.transport.server;

        // default router is used if no router is provided
        if (!this.router) {
          this.router = getDefaultRouter() as unknown as Routes;
        }

        if (server) {
          server.on('error', (err) => reject(err));
          server.on('request', toNodeHandler(this.router.handler));
        }

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
    Room.prototype['_onMessage'] = milliseconds <= Number.EPSILON ? originalOnMessage : (client, buffer) => {
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
}

export function defineServer<
  T extends Record<string, RegisteredHandler>,
  R extends Router
>(
  roomHandlers: T,
  router: R,
): Server<T, R> {
  const gameServer = new Server<T, R>();

  gameServer.router = router;

  for (const [name, handler] of Object.entries(roomHandlers)) {
    handler.name = name;
    matchMaker.addRoomType(handler);
  }

  return gameServer;
}

export function defineRoom<T extends Type<Room>>(
  roomKlass: T,
  defaultOptions?: Parameters<NonNullable<InstanceType<T>['onCreate']>>[0],
): RegisteredHandler<T> {
  return new RegisteredHandler(roomKlass, defaultOptions);
}
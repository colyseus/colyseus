import './loadenv.ts';
import os from 'os';
import fs from "fs";
import net from "net";
import http from 'http';
import type express from 'express';
import {
  type ServerOptions,
  type SDKTypes,
  type Router,
  logger,
  Server,
  Transport,
  matchMaker,
  RegisteredHandler,
  defineServer,
  dynamicImport,
} from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';

const BunWebSockets = dynamicImport('@colyseus/bun-websockets');
const RedisDriver = dynamicImport('@colyseus/redis-driver');
const RedisPresence = dynamicImport('@colyseus/redis-presence');

export interface ConfigOptions<
  RoomTypes extends Record<string, RegisteredHandler> = any,
  Routes extends Router = any
> extends SDKTypes<RoomTypes, Routes> {
    options?: ServerOptions,
    displayLogs?: boolean,
    rooms?: RoomTypes,
    routes?: Routes,
    initializeTransport?: (options: any) => Transport,
    initializeExpress?: (app: express.Application) => void,
    initializeGameServer?: (app: Server) => void,
    beforeListen?: () => void,
    /**
     * @deprecated getId() has no effect anymore.
     */
    getId?: () => string,
}

const ALLOWED_KEYS: { [key in keyof Partial<ConfigOptions>]: string } = {
  'displayLogs': "boolean",
  'options': "object",
  'rooms': "object",
  'routes': "object",
  'initializeTransport': "function",
  'initializeExpress': "function",
  'initializeGameServer': "function",
  'beforeListen': "function",
  // deprecated options (will be removed in the next major version)
  'getId': "function",
};

export default function <
  RoomTypes extends Record<string, RegisteredHandler> = any,
  Routes extends Router = any
>(options: Omit<ConfigOptions<RoomTypes, Routes>, '~rooms' | '~routes'>) {
  for (const option in options) {
    if (!ALLOWED_KEYS[option]) {
      throw new Error(`❌ Invalid option '${option}'. Allowed options are: ${Object.keys(ALLOWED_KEYS).join(", ")}`);
    }
    if(options[option] !== undefined && typeof(options[option]) !== ALLOWED_KEYS[option]) {
      throw new Error(`❌ Invalid type for ${option}: please provide a ${ALLOWED_KEYS[option]} value.`);
    }
  }
  return options as ConfigOptions<RoomTypes, Routes>;
}

/**
 * Expose server instance and listen on the port specified
 * @param options Application options
 * @param port Port number to bind Colyseus + Express
 */
export async function listen<
  RoomTypes extends Record<string, RegisteredHandler> = any,
  Routes extends Router = any
>(
    options: ConfigOptions<RoomTypes, Routes>,
    port?: number,
): Promise<Server<RoomTypes, Routes>>;

/**
 * Expose server instance and listen on the port specified
 * @param server Server instance
 * @param port Port number to bind Colyseus + Express
 */
export async function listen<
  RoomTypes extends Record<string, RegisteredHandler> = any,
  Routes extends Router = any
>(
    server: Server<RoomTypes, Routes>,
    port?: number,
): Promise<Server<RoomTypes, Routes>>;

export async function listen<
  RoomTypes extends Record<string, RegisteredHandler> = any,
  Routes extends Router = any
>(
    options: ConfigOptions<RoomTypes, Routes> | Server<RoomTypes, Routes>,
    port: number = Number(process.env.PORT || 2567),
) {
    // Force 2567 port on Colyseus Cloud
    if (process.env.COLYSEUS_CLOUD !== undefined) {
        port = 2567;
    }

    //
    // Handling multiple processes
    // Use NODE_APP_INSTANCE to play nicely with pm2
    //
    const processNumber = Number(process.env.NODE_APP_INSTANCE || "0");
    port += processNumber;

    let server: Server<RoomTypes, Routes>;
    let displayLogs = true;

    if (options instanceof Server) {
        server = options;

        // automatically configure for production under Colyseus Cloud
        // if on Colyseus Cloud, the matchMaker should have been configured by the time we get here
        // See @colyseus/core src/utils/Env.ts

    } else {
        server = await buildServerFromOptions<RoomTypes, Routes>(options, port);
        displayLogs = options.displayLogs;

        await options.initializeGameServer?.(server);
        await matchMaker.onReady;
        await options.beforeListen?.();
    }

    if (process.env.COLYSEUS_CLOUD !== undefined) {
        // listening on socket
        const socketPath = `/run/colyseus/${port}.sock`;
        // const socketPath: any = `/tmp/${port}.sock`;

        // check if .sock file is active
        // (fixes "ADDRINUSE" issue when restarting the server)
        await checkInactiveSocketFile(socketPath);

        await server.listen(
          socketPath,
          0 as any // workaround to allow using @colyseus/core's .listen() directly on Colyseus Cloud
        );

    } else {
        // listening on port
        await server.listen(port);
    }

    // notify process manager (production)
    if (typeof(process.send) === "function") {
        process.send('ready');
    }

    if (displayLogs) {
        logger.info(`⚔️  Listening on http://localhost:${port}`);
    }

    return server;
}

async function buildServerFromOptions<
  RoomTypes extends Record<string, RegisteredHandler> = any,
  Routes extends Router = any
>(options: ConfigOptions<RoomTypes, Routes>, port: number) {
  const serverOptions = options.options || {};
  options.displayLogs = options.displayLogs ?? true;

  // automatically configure for production under Colyseus Cloud
  if (process.env.COLYSEUS_CLOUD !== undefined) {
    const cloudConfig = await getColyseusCloudConfig(port, serverOptions.driver, serverOptions.presence);
    if (cloudConfig) {
      serverOptions.driver = cloudConfig.driver;
      serverOptions.presence = cloudConfig.presence;
      serverOptions.publicAddress = cloudConfig.publicAddress;
    }
  }

  return defineServer<RoomTypes, Routes>({
    rooms: options.rooms || {} as RoomTypes,
    routes: options.routes,
    ...serverOptions,
    express: options.initializeExpress,
    transport: await getTransport(options),
  });
}

export async function getTransport(options: ConfigOptions) {
    let transport: Transport;

    if (!options.initializeTransport) {
        // @ts-ignore
        if (typeof Bun !== "undefined") {
          // @colyseus/bun-websockets
          BunWebSockets.catch(() => {
            logger.warn("");
            logger.warn("❌ could not initialize BunWebSockets.");
            logger.warn("👉 npm install --save @colyseus/bun-websockets");
            logger.warn("");
          })
          const module = await BunWebSockets;
          options.initializeTransport = (options: any) => new module.BunWebSockets(options);

        } else {
          // use WebSocketTransport by default
          options.initializeTransport = (options: any) => new WebSocketTransport(options);
        }
    }

    // Create server without express app - the transport handles express via getExpressApp()
    const server = http.createServer();

    transport = await options.initializeTransport({ server });

    return transport;
}

/**
 * Configure Redis driver/presence for Colyseus Cloud when needed.
 * Returns configured driver, presence, and publicAddress.
 */
async function getColyseusCloudConfig(port: number, currentDriver?: any, currentPresence?: any) {
  const useRedisConfig = (os.cpus().length > 1) || (process.env.REDIS_URI !== undefined);

  if (!useRedisConfig) {
    return null;
  }

  let driver = currentDriver;
  let presence = currentPresence;
  const publicAddress = process.env.SUBDOMAIN + "." + process.env.SERVER_NAME + "/" + port;

  if (!driver) {
    try {
      const module = await RedisDriver;
      driver = new module.RedisDriver(process.env.REDIS_URI);
    } catch (e) {
      console.error(e);
      logger.warn("");
      logger.warn("❌ could not initialize RedisDriver.");
      logger.warn("👉 npm install --save @colyseus/redis-driver");
      logger.warn("");
    }
  }

  if (!presence) {
    try {
      const module = await RedisPresence;
      presence = new module.RedisPresence(process.env.REDIS_URI);
    } catch (e) {
      console.error(e);
      logger.warn("");
      logger.warn("❌ could not initialize RedisPresence.");
      logger.warn("👉 npm install --save @colyseus/redis-presence");
      logger.warn("");
    }
  }

  return { driver, presence, publicAddress };
}

/**
 * Check if a socket file is active and remove it if it's not.
 */
function checkInactiveSocketFile(sockFilePath: string) {
  return new Promise((resolve, reject) => {
    const client = net.createConnection({ path: sockFilePath })
      .on('connect', () => {
        // socket file is active, close the connection
        client.end();
        throw new Error(`EADDRINUSE: Already listening on '${sockFilePath}'`);
      })
      .on('error', () => {
        // socket file is inactive, remove it
        fs.unlink(sockFilePath, () => resolve(true));
      });
  });
}

import './loadenv.js';
import os from 'os';
import fs from "fs";
import net from "net";
import http from 'http';
import cors from 'cors';
import express from 'express';
import { logger, Server, ServerOptions, Transport, matchMaker } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';

const BunWebSockets = import('@colyseus/bun-websockets'); BunWebSockets.catch(() => {});
const RedisDriver = import('@colyseus/redis-driver'); RedisDriver.catch(() => {});
const RedisPresence = import('@colyseus/redis-presence'); RedisPresence.catch(() => {});

export interface ConfigOptions {
    options?: ServerOptions,
    displayLogs?: boolean,
    getId?: () => string,
    initializeTransport?: (options: any) => Transport,
    initializeExpress?: (app: express.Express) => void,
    initializeGameServer?: (app: Server) => void,
    beforeListen?: () => void,
}

const ALLOWED_KEYS: { [key in keyof ConfigOptions]: string } = {
  'displayLogs': "boolean",
  'options': "object",
  'getId': "function",
  'initializeTransport': "function",
  'initializeExpress': "function",
  'initializeGameServer': "function",
  'beforeListen': "function"
};

export default function (options: ConfigOptions) {
  for (const option in options) {
    if (!ALLOWED_KEYS[option]) {
      throw new Error(`❌ Invalid option '${option}'. Allowed options are: ${Object.keys(ALLOWED_KEYS).join(", ")}`);
    }
    if(options[option] !== undefined && typeof(options[option]) !== ALLOWED_KEYS[option]) {
      throw new Error(`❌ Invalid type for ${option}: please provide a ${ALLOWED_KEYS[option]} value.`);
    }
  }

  return options;
}

/**
 * Listen on your development environment
 * @param options Application options
 * @param port Port number to bind Colyseus + Express
 */
export async function listen(
    options: ConfigOptions | Server,
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

    let gameServer: Server;
    let displayLogs = true;

    if (options instanceof Server) {
        gameServer = options;

    } else {
        gameServer = await buildServerFromOptions(options, port);
        displayLogs = options.displayLogs;

        await options.initializeGameServer?.(gameServer);
        await matchMaker.onReady;
        await options.beforeListen?.();
    }

    if (process.env.COLYSEUS_CLOUD !== undefined) {
        // listening on socket
        const socketPath: any = `/run/colyseus/${port}.sock`;

        // check if .sock file is active
        // (fixes "ADDRINUSE" issue when restarting the server)
        await checkInactiveSocketFile(socketPath);

        await gameServer.listen(socketPath);

    } else {
        // listening on port
        await gameServer.listen(port);
    }

    // notify process manager (production)
    if (typeof(process.send) === "function") {
        process.send('ready');
    }

    if (displayLogs) {
        logger.info(`⚔️  Listening on http://localhost:${port}`);
    }

    return gameServer;
}

async function buildServerFromOptions(options: ConfigOptions, port: number) {
  const serverOptions = options.options || {};
  options.displayLogs = options.displayLogs ?? true;

  // automatically configure for production under Colyseus Cloud
  if (process.env.COLYSEUS_CLOUD !== undefined) {

    // special configuration is required when using multiple processes
    const useRedisConfig = (os.cpus().length > 1) || (process.env.REDIS_URI !== undefined);

    if (!serverOptions.driver && useRedisConfig) {
      try {
        const module = await RedisDriver;
        serverOptions.driver = new module.RedisDriver(process.env.REDIS_URI);
      } catch (e) {
        console.error(e);
        logger.warn("");
        logger.warn("❌ could not initialize RedisDriver.");
        logger.warn("👉 npm install --save @colyseus/redis-driver");
        logger.warn("");
      }
    }

    if (!serverOptions.presence && useRedisConfig) {
      try {
        const module = await RedisPresence;
        serverOptions.presence = new module.RedisPresence(process.env.REDIS_URI);
      } catch (e) {
        console.error(e);
        logger.warn("");
        logger.warn("❌ could not initialize RedisPresence.");
        logger.warn("👉 npm install --save @colyseus/redis-presence");
        logger.warn("");
      }
    }

    if (useRedisConfig) {
      // force "publicAddress" when more than 1 process is available
      serverOptions.publicAddress = process.env.SUBDOMAIN + "." + process.env.SERVER_NAME;

      // nginx is responsible for forwarding /{port}/ to this process
      serverOptions.publicAddress += "/" + port;
    }
  }

  const transport = await getTransport(options);
  return new Server({
    ...serverOptions,
    transport,
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

    let app: express.Express | undefined = express();
    let server = http.createServer(app);

    transport = await options.initializeTransport({ server, app });

    //
    // TODO: refactor me!
    // BunWebSockets: There's no need to instantiate "app" and "server" above
    //
    if (transport['expressApp']) {
      app = transport['expressApp'];
    }

    if (app) {
      // Enable CORS
      app.use(cors({ origin: true, credentials: true, }));

      if (options.initializeExpress) {
          await options.initializeExpress(app);
      }

      // health check for load balancers
      app.get("/__healthcheck", (req, res) => {
        res.status(200).end();
      });

      if (options.displayLogs) {
          logger.info("✅ Express initialized");
      }
    }

    return transport;
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
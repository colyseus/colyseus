import "./loadenv";
import os from "os";
import fs from "fs";
import net from "net";
import http from "http";
import cors from "cors";
import express from "express";
import osUtils from "node-os-utils";
import { logger, Server, ServerOptions, Transport, matchMaker } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';

// try to import uWebSockets-express compatibility layer.
let uWebSocketsExpressCompatibility: any = undefined;
try { uWebSocketsExpressCompatibility = require('uwebsockets-express').default; } catch (e) { }

let BunWebSockets: any = undefined;
try { BunWebSockets = require('@colyseus/bun-websockets'); } catch (e) { }

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
    options: ConfigOptions,
    port: number = Number(process.env.PORT || 2567),
) {
    const serverOptions = options.options || {};
    options.displayLogs = options.displayLogs ?? true;

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

    let portOrSocket: any = port;

    // automatically configure for production under Colyseus Cloud
    if (process.env.COLYSEUS_CLOUD !== undefined) {
        portOrSocket = `/run/colyseus/${port}.sock`;

        // check if .sock file is active
        // (fixes "ADDRINUSE" issue when restarting the server)
        await checkInactiveSocketFile(portOrSocket);

        // special configuration is required when using multiple processes
        const useRedisConfig = (os.cpus().length > 1) || (process.env.REDIS_URI !== undefined);

        if (!serverOptions.driver && useRedisConfig) {
            let RedisDriver: any = undefined;
            try {
                RedisDriver = require('@colyseus/redis-driver').RedisDriver;
                serverOptions.driver = new RedisDriver(process.env.REDIS_URI);
            } catch (e) {
                logger.warn("");
                logger.warn("❌ could not initialize RedisDriver.");
                logger.warn("👉 npm install --save @colyseus/redis-driver");
                logger.warn("");
            }
        }

        if (!serverOptions.presence && useRedisConfig) {
            let RedisPresence: any = undefined;
            try {
                RedisPresence = require('@colyseus/redis-presence').RedisPresence;
                serverOptions.presence = new RedisPresence(process.env.REDIS_URI);
            } catch (e) {
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
    const gameServer = new Server({
        ...serverOptions,
        transport,
    });
    await options.initializeGameServer?.(gameServer);
    await matchMaker.onReady;
    await options.beforeListen?.();

    // listening on port or socket
    await gameServer.listen(portOrSocket);

    // notify process manager (production)
    if (typeof(process.send) === "function") {
        process.send('ready');
    }

    if (options.displayLogs) {
        logger.info(`⚔️  Listening on http://localhost:${port}`);
    }
    return gameServer;
}


export async function getTransport(options: ConfigOptions) {
    let transport: Transport;

    if (!options.initializeTransport) {
        if (BunWebSockets !== undefined) {
          // @colyseus/bun-websockets
          options.initializeTransport = (options: any) => new BunWebSockets.BunWebSockets(options);

        } else {
          // use WebSocketTransport by default
          options.initializeTransport = (options: any) => new WebSocketTransport(options);
        }
    }

    let app: express.Express | undefined = express();
    let server = http.createServer(app);

    transport = await options.initializeTransport({ server });

    //
    // TODO: refactor me!
    // BunWebSockets: There's no need to instantiate "app" and "server" above
    //
    if (transport['expressApp']) {
      app = transport['expressApp'];
    }

    if (options.initializeExpress) {
        // uWebSockets.js + Express compatibility layer.
        // @ts-ignore
        if (transport['app']) {
            if (typeof (uWebSocketsExpressCompatibility) === "function") {
                if (options.displayLogs){
                  logger.info("✅ uWebSockets.js + Express compatibility enabled");
                }

                // @ts-ignore
                server = undefined;
                // @ts-ignore
                app = uWebSocketsExpressCompatibility(transport['app']);

            } else {
                if (options.displayLogs) {
                    logger.warn("");
                    logger.warn("❌ uWebSockets.js + Express compatibility mode couldn't be loaded, run the following command to fix:");
                    logger.warn("👉 npm install --save uwebsockets-express");
                    logger.warn("");
                }
                app = undefined;
            }
        }
    }

    if (app) {
      // Enable CORS
      app.use(cors({ origin: true, credentials: true, }));

      // Enable JSON parsing.
      app.use(express.json());

      if (options.initializeExpress) {
          await options.initializeExpress(app);
      }

      // health check for load balancers
      app.get("/__healthcheck", (req, res) => {
        res.status(200).end();
      });

      app.get("/__cloudstats", async (req, res) => {
          if (
              process.env.CLOUD_SECRET &&
              req.headers.authorization !== process.env.CLOUD_SECRET
          ) {
              res.status(401).end();
              return;
          }

          // count rooms per process
          const rooms = (await matchMaker.stats.fetchAll()).reduce((prev, curr) => {
            return prev + curr.roomCount;
          }, 0);

          const ccu = await matchMaker.stats.getGlobalCCU();
          const mem = await osUtils.mem.used();
          const cpu = (await osUtils.cpu.usage()) / 100;

          res.json({
              version: 1,
              mem: (mem.usedMemMb / mem.totalMemMb),
              cpu,
              ccu,
              rooms,
          });
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
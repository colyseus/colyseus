import fs from "fs";
import os from "os";
import http from "http";
import path from "path";
import cors from "cors";
import express from "express";
import dotenv from "dotenv";
import osUtils from "node-os-utils";
import { logger, Server, ServerOptions, Transport, matchMaker } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';

// try to import uWebSockets-express compatibility layer.
let uWebSocketsExpressCompatibility: any = undefined;
try { uWebSocketsExpressCompatibility = require('uwebsockets-express').default; } catch (e) {}

let BunWebSockets: any = undefined;
try { BunWebSockets = require('@colyseus/bun-websockets'); } catch (e) {}

function getNodeEnv() {
  return process.env.NODE_ENV || "development";
}

function getRegion() {
  // EU, NA, AS, AF, AU, SA, UNKNOWN
  return (process.env.REGION || "unknown").toLowerCase();
}

function loadEnvFile(envFileOptions: string[], log: 'none' | 'success' | 'both'  = 'none') {
    const envPaths = [];
    envFileOptions.forEach((envFilename) => {
      envPaths.push(path.resolve(path.dirname(require?.main?.filename || process.cwd()), "..", envFilename));
      envPaths.push(path.resolve(process.cwd(), envFilename));
    });

    // return the first .env path found
    const envPath = envPaths.find((envPath) => fs.existsSync(envPath));

    if (envPath) {
        dotenv.config({ path: envPath });

        if (log !== "none") {
            logger.info(`✅ ${path.basename(envPath)} loaded.`);
        }

    } else if (log === "both") {
        logger.info(`ℹ️  optional .env file not found: ${envFileOptions.join(", ")}`);
    }
}

// load .env.cloud defined on admin panel
if (process.env.COLYSEUS_CLOUD !== undefined) {
    loadEnvFile([`.env.cloud`]);
}

// (overrides previous env configs)
loadEnvFile([`.env.${getNodeEnv()}`, `.env`], 'both');

if (process.env.REGION !== undefined) {
  loadEnvFile([`.env.${getRegion()}.${getNodeEnv()}`], 'success');
}

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

    // automatically configure for production under Colyseus Cloud
    if (process.env.COLYSEUS_CLOUD !== undefined) {
        // special configuration is required when using multiple processes
        const useRedisConfig = (os.cpus().length > 1) || (process.env.REDIS_URI !== undefined);

        if (!serverOptions.driver && useRedisConfig) {
            let RedisDriver: any = undefined;
            try {
                RedisDriver = require('@colyseus/redis-driver').RedisDriver;
                serverOptions.driver = new RedisDriver(process.env.REDIS_URI);
            } catch (e) {
                logger.warn("");
                logger.warn("❌ coult not initialize RedisDriver.");
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
                logger.warn("❌ coult not initialize RedisPresence.");
                logger.warn("👉 npm install --save @colyseus/redis-presence");
                logger.warn("");
            }
        }

        // force "publicAddress" when deployed on "Colyseus Cloud".
        serverOptions.publicAddress = process.env.SUBDOMAIN + "." + process.env.SERVER_NAME;

        // nginx is responsible for forwarding /{port}/ to this process
        if (useRedisConfig) {
            serverOptions.publicAddress += "/" + port;
        }
    }

    const transport = await getTransport(options);
    const gameServer = new Server({
        ...serverOptions,
        transport,
    });
    await options.initializeGameServer?.(gameServer);
    await options.beforeListen?.();


    if (process.env.COLYSEUS_CLOUD !== undefined) {
        // listening on socket
        // @ts-ignore
        await gameServer.listen(`/run/colyseus/${port}.sock`);

    } else {
        // listening on port
        await gameServer.listen(port);
    }

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
      // Enable CORS + JSON parsing.
      app.use(cors());
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

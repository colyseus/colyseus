import fs from "fs";
import os from "os";
import http from "http";
import path from "path";
import cors from "cors";
import express from "express";
import dotenv from "dotenv";
import { logger, Server, ServerOptions, Transport } from '@colyseus/core';

// try to import uWebSockets-express compatibility layer.
let uWebSocketsExpressCompatibility: any;
try {
  uWebSocketsExpressCompatibility = require('uwebsockets-express').default;
} catch (e) {}

const envFilename = `.env.${process.env.NODE_ENV || "development"}`;

// return the first .env path found
const envPath = [
  path.resolve(path.dirname(require?.main?.filename || process.cwd()), "..", envFilename),
  path.resolve(process.cwd(), envFilename)
].find((envPath) => fs.existsSync(envPath));

if (envPath) {
    dotenv.config({ path: envPath });
    logger.info(`✅ ${envFilename} loaded.`);
} else {
    logger.info(`⚠️  ${envFilename} not found.`);
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
    if(typeof(options[option]) !== ALLOWED_KEYS[option]) {
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

    //
    // Handling multiple processes
    // Use NODE_APP_INSTANCE to play nicely with pm2
    //
    const processNumber = Number(process.env.NODE_APP_INSTANCE || "0");
    port += processNumber;

    // automatically configure for production under Colyseus Cloud
    if (process.env.COLYSEUS_CLOUD !== undefined) {
        // special configuration is required when using multiple processes
        const isMultiProcess = (os.cpus().length > 1);

        if (!serverOptions.driver && isMultiProcess) {
            let RedisDriver: any = undefined;
            try {
                RedisDriver = require('@colyseus/redis-driver').RedisDriver;
                serverOptions.driver = new RedisDriver();
            } catch (e) {
                logger.warn("");
                logger.warn("❌ coult not initialize RedisDriver.");
                logger.warn("👉 npm install --save @colyseus/redis-driver");
                logger.warn("");
            }
        }

        if (!serverOptions.presence && isMultiProcess) {
            let RedisPresence: any = undefined;
            try {
                RedisPresence = require('@colyseus/redis-presence').RedisPresence;
                serverOptions.presence = new RedisPresence();
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
        if (isMultiProcess) {
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

    // listening on port
    await gameServer.listen(port);

    // notify process manager (production)
    if (typeof(process.send) === "function") {
        process.send('ready');
    }

    if (options.displayLogs) {
        const appId = options.getId?.() || "[ Colyseus ]";
        if (appId) {
            logger.info(`🏟  ${appId}`);
        }

        logger.info(`⚔️  Listening on ws://localhost:${port}`);
    }
    return gameServer;
}


export async function getTransport(options: ConfigOptions) {
    let transport: Transport;

    if (!options.initializeTransport) {
        options.initializeTransport = Server.prototype['getDefaultTransport'];
    }

    let app: express.Express | undefined = express();
    let server = http.createServer(app);

    transport = await options.initializeTransport({ server });

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

        if (app) {
            // Enable CORS + JSON parsing.
            app.use(cors());
            app.use(express.json());

            await options.initializeExpress(app);

            if (options.displayLogs) {
                logger.info("✅ Express initialized");
            }
        }
    }

    return transport;
}

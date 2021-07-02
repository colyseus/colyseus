import fs from "fs";
import http from "http";
import path from "path";
import cors from "cors";
import express from "express";
import dotenv from "dotenv";
import { Server, Transport } from "@colyseus/core";

// try to import uWebSockets-express compatibility layer.
let uWebSocketsExpressCompatibility: any;
try { uWebSocketsExpressCompatibility = require('uwebsockets-express').default;
} catch (e) {}

/**
 * Do not auto-load `${environment}.env` file when using Arena service.
 */
if (process.env.NODE_ARENA !== "true") {
    const envFilename = (process.env.NODE_ENV === "production")
        ? "arena.env"
        : `${process.env.NODE_ENV || "development"}.env`

    const envPath = path.resolve(path.dirname(require?.main?.filename || process.cwd()), "..", envFilename);

    if (fs.existsSync(envPath)) {
        dotenv.config({ path: envPath });
        console.log(`✅ ${envFilename} loaded.`);

    } else {
        console.log(`⚠️  ${envFilename} not found.`);
    }
}

export interface ArenaOptions {
    getId?: () => string,
    initializeTransport?: (options: any) => Transport,
    initializeExpress?: (app: express.Express) => void,
    initializeGameServer?: (app: Server) => void,
    beforeListen?: () => void,
}

const ALLOWED_KEYS: Array<keyof ArenaOptions> = [
  'getId',
  'initializeTransport',
  'initializeExpress',
  'initializeGameServer',
  'beforeListen'
];

export default function (options: ArenaOptions) {
    for (let key in options) {
        if (ALLOWED_KEYS.indexOf(key as keyof ArenaOptions) === -1) {
            throw new Error(`Invalid option '${key}'. Allowed options are: ${ALLOWED_KEYS.join(", ")}`);

        } else if (typeof(options[key as keyof ArenaOptions]) !== "function") {
            throw new Error(`'${key}' should be a function.`);
        }
    }

    return options;
}

/**
 * Listen on your development environment
 * @param options Arena options
 * @param port Port number to bind Colyseus + Express
 */
export async function listen(
    options: ArenaOptions,
    port: number = Number(process.env.PORT || 2567)
) {
    const transport = await getTransport(options);
    const gameServer = new Server({
        transport,
        // ...?
    });
    await options.initializeGameServer?.(gameServer);
    await options.beforeListen?.();

    gameServer.listen(port);

    const appId = options.getId?.() || "[ Colyseus ]";
    if (appId) { console.log(`🏟  ${appId}`); }

    console.log(`⚔️  Listening on ws://localhost:${ port }`);
}


export async function getTransport(options: ArenaOptions) {
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
                console.info("✅ uWebSockets.js + Express compatibility enabled");
                // @ts-ignore
                server = undefined;
                // @ts-ignore
                app = uWebSocketsExpressCompatibility(transport['app']);

            } else {
                console.warn("");
                console.warn("❌ uWebSockets.js + Express compatibility mode couldn't be loaded, run the following command to fix:");
                console.warn("👉 npm install --save uwebsockets-express");
                console.warn("");
                app = undefined;
            }
        }

        if (app) {
            // Enable CORS + JSON parsing.
            app.use(cors());
            app.use(express.json());

            await options.initializeExpress(app);
            console.info("✅ Express initialized");
        }
    }

    return transport;
}
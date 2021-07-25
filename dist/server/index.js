"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const cors_1 = __importDefault(require("cors"));
const express_1 = __importDefault(require("express"));
const os_1 = require("os");
const src_1 = require("../packages/core/src");
const src_2 = require("../bundles/colyseus/src");
const src_3 = require("../packages/presence/redis-presence/src");
const src_4 = require("../packages/drivers/redis-driver/src");
const src_5 = require("../packages/transport/uwebsockets-transport/src");
const uwebsockets_express_1 = __importDefault(require("uwebsockets-express"));
const prometheus = __importStar(require("prom-client"));
const dotenv = __importStar(require("dotenv"));
const morgan_1 = __importDefault(require("morgan"));
//Custom Utilities 
const logger_1 = __importDefault(require("./utilities/logger"));
const SHOW_ARENA_ERRORS = Boolean(Number(process.env.SHOW_ARENA_ERRORS || "1"));
const SHOW_ARENA_ENV = Boolean(Number(process.env.SHOW_ARENA_ENV || "1"));
const StatsController = __importStar(require("./controllers/statsController"));
//Check to see if we need to load a different file
let envFilename = (process.env.NODE_ENV === "production")
    ? "arena.env"
    : process.env.NODE_ENV + ".env";
let envResults = dotenv.config({ path: '/colyseus/app/server/arena/' + envFilename });
//Check for production.env if arena cannot be found
if (envFilename === "arena.env" && envResults.error) {
    console.log("Arena-Env: Could not find 'arena.env', checking for " + process.env.NODE_ENV + ".env instead...");
    envFilename = process.env.NODE_ENV + ".env";
    envResults = dotenv.config({ path: '/colyseus/app/server/arena/' + envFilename });
}
if (envResults.error) {
    console.log("Arena-Env: No Valid File found");
    if (SHOW_ARENA_ERRORS) {
        console.error(envResults.error);
    }
}
else {
    console.log("Arena-Env (" + envFilename + "):");
    if (SHOW_ARENA_ENV) {
        console.log(JSON.stringify(envResults.parsed, null, 4));
    }
    //override for NODE_ENV
    if (envResults.parsed.NODE_ENV != null) {
        console.log("NODE_ENV has been overridden to '" + envResults.parsed.NODE_ENV + "'");
        process.env.NODE_ENV = envResults.parsed.NODE_ENV;
    }
    if (envResults.parsed.MONGO_URI != null) {
        console.error("MONGO_URI cannot be overridden!");
    }
    if (envResults.parsed.USE_REDIS != null ||
        envResults.parsed.REDIS_PORT != null ||
        envResults.parsed.USE_PROXY != null ||
        envResults.parsed.USE_PROXY_PORT != null ||
        envResults.parsed.SERVER_URL != null ||
        envResults.parsed.PORT != null) {
        console.error("Defaults cannot be overridden!");
    }
}
let arenaConfig = undefined;
try {
    arenaConfig = require('./arena/arena.config');
    if (arenaConfig.default) {
        arenaConfig = arenaConfig.default;
    }
    logger_1.default.info("Arena-Config: Custom File found.");
    logger_1.default.info(arenaConfig.getId());
}
catch (error) {
    arenaConfig = undefined;
    logger_1.default.info("Arena-Config: No valid file provided");
    logger_1.default.info("*** Have you DEPLOYED your server code? ****");
    if (SHOW_ARENA_ERRORS) {
        console.error(error);
    }
}
const getLocalExternalIp = () => [].concat.apply([], Object.values(os_1.networkInterfaces()))
    .filter(details => details.family === 'IPv4' && !details.internal)
    .pop().address;
const PORT = Number(process.env.PORT || 2567);
const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://';
const USE_REDIS = process.env.USE_REDIS || null;
const REDIS_PORT = Number(process.env.REDIS_PORT) || 6379;
const USE_PROXY = process.env.USE_PROXY || null;
const USE_PROXY_PORT = Number(process.env.USE_PROXY_PORT || 2567);
const MY_POD_NAMESPACE = process.env.MY_POD_NAMESPACE || undefined;
const MY_POD_NAME = process.env.MY_POD_NAME || "LOCALPOD";
const MY_POD_IP = process.env.MY_POD_IP != null ? (process.env.MY_POD_IP === "useip" ? getLocalExternalIp() : process.env.MY_POD_IP) : '0.0.0.0';
const APIVERSION = process.env.APIVERSION || "0.14.18-Base";
const API_KEY = process.env.API_KEY || "LOCALKEY";
const SERVER_URL = process.env.SERVER_URL || "localhost";
//Sets Env for remaining app
if (process.env.MY_POD_IP && process.env.MY_POD_IP === "useip") {
    process.env.MY_POD_IP = getLocalExternalIp();
}
//*** STATS */
prometheus.collectDefaultMetrics({
    gcDurationBuckets: [0.001, 0.01, 0.1, 1, 2, 5], // These are the default buckets.
});
//CCU Counter
const Gauge = prometheus.Gauge;
const globalCCU = new Gauge({
    name: 'colyseus_arena_ccu_gauge',
    help: 'Arena Server Active CCU Count of this server',
    labelNames: ['code'],
});
const totalRoomCount = new Gauge({
    name: 'colyseus_arena_total_rooms_gauge',
    help: 'Arena Server Total Rooms Count of this server',
    labelNames: ['code'],
});
const lockedRoomCount = new Gauge({
    name: 'colyseus_arena_locked_rooms_gauge',
    help: 'Arena Server Locked Rooms Count of this server',
    labelNames: ['code'],
});
StatsController.setPrometheusCounters(globalCCU, totalRoomCount, lockedRoomCount);
///**** New Server Code */
const port = Number(PORT || 2567);
const endpoint = SERVER_URL;
// Create HTTP & WebSocket servers
const transport = new src_5.uWebSocketsTransport();
const gameServer = new src_1.Server({
    transport,
    // server: server,
    presence: (USE_REDIS != null) ? new src_3.RedisPresence({ port: REDIS_PORT, host: USE_REDIS }, API_KEY + "_roomcaches") : new src_2.LocalPresence(),
    driver: (USE_REDIS != null) ? new src_4.RedisDriver({ port: REDIS_PORT, host: USE_REDIS }, API_KEY + "_roomcaches") : new src_2.LocalDriver(),
});
const app = uwebsockets_express_1.default(transport.app);
app.use(cors_1.default());
app.use(express_1.default.json());
app.use(morgan_1.default("combined", { "stream": logger_1.default.stream }));
app.get('/metrics', async (req, res) => {
    try {
        res.set('Content-Type', prometheus.register.contentType);
        res.end(await prometheus.register.metrics());
    }
    catch (ex) {
        res.status(500).end(ex);
    }
});
app.get('/metrics/ccu', async (req, res) => {
    try {
        res.set('Content-Type', prometheus.register.contentType);
        res.end(await prometheus.register.getSingleMetricAsString(API_KEY + '_ccu_counter'));
    }
    catch (ex) {
        res.status(500).end(ex);
    }
});
app.get("/hello", (req, res) => {
    res.json({ hello: "world!" });
});
gameServer.define("lobby", src_1.LobbyRoom);
// Define RelayRoom as "relay"
gameServer.define("relay", src_1.RelayRoom);
SetupArena();
async function SetupArena() {
    if (arenaConfig != undefined) {
        logger_1.default.info("Arena-Config: Attempting Custom Game Server Rooms");
        try {
            if (await arenaConfig.initializeGameServer(gameServer) === false) {
                logger_1.default.error("ERROR: Failed Custom Game Server Rooms");
            }
            else {
                logger_1.default.info("Success!");
            }
        }
        catch (error) {
            logger_1.default.error("CRITICAL ERROR: Custom Game Server Rooms");
            console.error(error);
        }
    }
}
gameServer.onShutdown(() => {
    console.log("CUSTOM SHUTDOWN ROUTINE: STARTED");
    return new Promise((resolve, reject) => {
        setTimeout(() => {
            console.log("CUSTOM SHUTDOWN ROUTINE: FINISHED");
            resolve();
        }, 1000);
    });
});
process.on('unhandledRejection', r => console.log('unhandledRejection...', r));
SetupArenaPreListen();
async function SetupArenaPreListen() {
    if (arenaConfig != undefined) {
        logger_1.default.info("Arena-Config: Attempting Pre Listen Functions");
        try {
            if (await arenaConfig.beforeListen() === false) {
                logger_1.default.error("ERROR: Failed Pre Listen Functions");
            }
            else {
                logger_1.default.info("Success!");
            }
        }
        catch (error) {
            logger_1.default.error("CRITICAL ERROR: Pre Listen Functions");
            console.error(error);
        }
    }
}
gameServer.listen(port)
    .then(() => console.log(`Colyseus ${APIVERSION}: Listening on ws://${endpoint}:${port}`))
    .catch((err) => {
    console.log(err);
    process.exit(1);
});
//--------Shutdown -----
// quit on ctrl-c when running docker in terminal
process.on('SIGINT', function onSigint() {
    logger_1.default.info('Got SIGINT (aka ctrl-c in docker). Graceful shutdown ', new Date().toISOString());
    shutdown();
});
// quit properly on docker stop
process.on('SIGTERM', function onSigterm() {
    logger_1.default.info('Got SIGTERM (docker container stop). Graceful shutdown ', new Date().toISOString());
    shutdown();
});
process.once('SIGUSR2', function () {
    logger_1.default.info('Got SIGUSR2 (Nodemon Restart). Graceful shutdown ', new Date().toISOString());
    shutdown();
});
// shut down server
async function shutdown() {
    // NOTE: server.close is for express based apps
    // If using hapi, use `server.stop`
    //TODO: Add arena hookup here for custom shutdown
    // await mongoose.connection.close();
    //Shutdown Game Server
    // gameServer.gracefullyShutdown();
}
//# sourceMappingURL=index.js.map
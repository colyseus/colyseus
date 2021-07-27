import http from "http";
import cors from "cors";
import express from "express";
import { networkInterfaces } from "os";

import { Server, RelayRoom, LobbyRoom} from "../packages/core/src";
import { LocalDriver, LocalPresence} from "../bundles/colyseus/src";
import { RedisPresence } from "../packages/presence/redis-presence/src";
import { RedisDriver } from "../packages/drivers/redis-driver/src";
import { uWebSocketsTransport } from "../packages/transport/uwebsockets-transport/src";
import expressify from "uwebsockets-express";

import * as prometheus from "prom-client";
import * as dotenv from "dotenv";
import morgan from "morgan";
//Custom Utilities 
import logger from "./utilities/logger";

const SHOW_ARENA_ERRORS =  Boolean(Number(process.env.SHOW_ARENA_ERRORS || "1" ));
const SHOW_ARENA_ENV =  Boolean(Number(process.env.SHOW_ARENA_ENV || "1" ));

import * as StatsController from '../packages/core/src/controllers/statsController';
//Check to see if we need to load a different file
let envFilename = (process.env.NODE_ENV === "production") 
    ? "arena.env"
    : process.env.NODE_ENV+".env"

let envResults = dotenv.config({ path: '/colyseus/app/server/arena/' + envFilename });
//Check for production.env if arena cannot be found
if (envFilename === "arena.env" && envResults.error) {
    console.log("Arena-Env: Could not find 'arena.env', checking for "+process.env.NODE_ENV+".env instead..." )
    envFilename = process.env.NODE_ENV+".env";
    envResults = dotenv.config({ path: '/colyseus/app/server/arena/' + envFilename });
}


if (envResults.error) {
    console.log("Arena-Env: No Valid File found");
    if(SHOW_ARENA_ERRORS) {
      console.error(envResults.error);
    }
  } else {
    console.log("Arena-Env ("+envFilename+"):");
    if(SHOW_ARENA_ENV) {
      console.log(JSON.stringify(envResults.parsed, null, 4));
    }
    
    //override for NODE_ENV
    if(envResults.parsed.NODE_ENV != null) {
      console.log("NODE_ENV has been overridden to '" + envResults.parsed.NODE_ENV+"'")
      process.env.NODE_ENV = envResults.parsed.NODE_ENV;
    }
    if(envResults.parsed.MONGO_URI != null) {
      console.error("MONGO_URI cannot be overridden!")
    }
    if(envResults.parsed.USE_REDIS != null ||
      envResults.parsed.REDIS_PORT != null ||
      envResults.parsed.USE_PROXY != null ||
      envResults.parsed.USE_PROXY_PORT != null ||
      envResults.parsed.SERVER_URL != null ||
      envResults.parsed.PORT != null
      ) {
      console.error("Defaults cannot be overridden!")
    }
}

let arenaConfig = undefined;
try {
  arenaConfig = require('./arena/arena.config');
  if (arenaConfig.default) {
    arenaConfig = arenaConfig.default;
  }

  logger.info("Arena-Config: Custom File found.");
  logger.info(arenaConfig.getId());
} catch (error) {
  arenaConfig = undefined;
  logger.info("Arena-Config: No valid file provided");
  logger.info("*** Have you DEPLOYED your server code? ****");
  if(SHOW_ARENA_ERRORS) {
    console.error(error);
    }
}

const getLocalExternalIp = () => [].concat.apply([], Object.values(networkInterfaces()))
  .filter(details => details.family === 'IPv4' && !details.internal)
  .pop().address

const PORT = Number(process.env.PORT || 2567);
const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://';
const USE_REDIS = process.env.USE_REDIS || null;
const REDIS_PORT: number = Number(process.env.REDIS_PORT) || 6379; 
const USE_PROXY = process.env.USE_PROXY || null; 
const USE_PROXY_PORT = Number(process.env.USE_PROXY_PORT || 2567); 
const MY_POD_NAMESPACE = process.env.MY_POD_NAMESPACE || undefined;
const MY_POD_NAME = process.env.MY_POD_NAME || "LOCALPOD";
const MY_POD_IP = process.env.MY_POD_IP != null ? (process.env.MY_POD_IP === "useip" ? getLocalExternalIp() : process.env.MY_POD_IP) : '0.0.0.0';
const APIVERSION = process.env.APIVERSION || "0.14.18-Base";
const API_KEY = process.env.API_KEY || "LOCALKEY";
const SERVER_URL = process.env.SERVER_URL || "localhost";

//Sets Env for remaining app
if(process.env.MY_POD_IP && process.env.MY_POD_IP === "useip") {
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
const transport = new uWebSocketsTransport();

const gameServer = new Server({
  transport,
  // server: server,
  presence: (USE_REDIS != null) ?  new RedisPresence({ port: REDIS_PORT, host : USE_REDIS }, API_KEY+"_presencecaches") : new LocalPresence(),
  driver: (USE_REDIS != null) ? new RedisDriver({ port: REDIS_PORT, host : USE_REDIS }, API_KEY+"_roomcaches") : new LocalDriver(),
});

const app = expressify(transport.app);
app.use(cors());
app.use(express.json());
app.use(morgan("combined", { "stream": logger.stream }));

app.get('/metrics', async (req, res) => {
	try {
		res.set('Content-Type', prometheus.register.contentType);
		res.end(await prometheus.register.metrics());
	} catch (ex) {
		res.status(500).end(ex);
	}
});

app.get('/metrics/ccu', async (req, res) => {
	try {
		res.set('Content-Type', prometheus.register.contentType);
		res.end(await prometheus.register.getSingleMetricAsString(API_KEY+'_ccu_counter'));
	} catch (ex) {
		res.status(500).end(ex);
	}
});

app.get("/hello", (req, res) => {
  res.json({hello: "world!"});
});

gameServer.define("lobby", LobbyRoom);

// Define RelayRoom as "relay"
gameServer.define("relay", RelayRoom);

SetupArena();

async function SetupArena() {
  if(arenaConfig != undefined) {
    logger.info("Arena-Config: Attempting Custom Game Server Rooms");
    try {
      if(await arenaConfig.initializeGameServer(gameServer) === false) {
        logger.error("ERROR: Failed Custom Game Server Rooms");
      } else {
        logger.info("Success!");
      }
    } catch (error) {
      logger.error("CRITICAL ERROR: Custom Game Server Rooms");
      console.error(error);
    }
    
  }
}



gameServer.onShutdown(() => {
  console.log("CUSTOM SHUTDOWN ROUTINE: STARTED");
  return new Promise<void>((resolve, reject) => {
    setTimeout(() => {
      console.log("CUSTOM SHUTDOWN ROUTINE: FINISHED");
      resolve();
    }, 1000);
  })
});

process.on('unhandledRejection', r => console.log('unhandledRejection...', r));

SetupArenaPreListen();

async function SetupArenaPreListen() {
  if(arenaConfig != undefined) {
    logger.info("Arena-Config: Attempting Pre Listen Functions");
    try {
      if(await arenaConfig.beforeListen() === false) {
        logger.error("ERROR: Failed Pre Listen Functions");
      } else {
        logger.info("Success!");
      }
    } catch (error) {
      logger.error("CRITICAL ERROR: Pre Listen Functions");
      console.error(error);
    }
  }
}

gameServer.listen(port)
  .then(() => console.log(`Colyseus ${ APIVERSION }: Listening on ws://${endpoint}:${port}`))
  .catch((err) => {
    console.log(err);
    process.exit(1)
});

//--------Shutdown -----

// quit on ctrl-c when running docker in terminal
process.on('SIGINT', function onSigint () {
	logger.info('Got SIGINT (aka ctrl-c in docker). Graceful shutdown ', new Date().toISOString());
  shutdown();
});

// quit properly on docker stop
process.on('SIGTERM', function onSigterm () {
  logger.info('Got SIGTERM (docker container stop). Graceful shutdown ', new Date().toISOString());
  shutdown();
});

process.once('SIGUSR2', function() {
  logger.info('Got SIGUSR2 (Nodemon Restart). Graceful shutdown ', new Date().toISOString());
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
import http from "http";
import cors from "cors";
import express from "express";

import { Server, RedisPresence, RelayRoom } from "../src";
import { ChatRoom } from "./ChatRoom";

import { MongooseDriver } from "../src/matchmaker/drivers/MongooseDriver";

const port = Number(process.env.PORT || 2567);
const endpoint = "localhost";

const app = express();

app.use(cors());
app.use(express.json());

// Create HTTP & WebSocket servers
const server = http.createServer(app);
const gameServer = new Server({
  // engine: WebSocket.Server,
  server: server,
  // presence: new RedisPresence(),
  // express: app,
  // driver: new MongooseDriver(),
});

app.get("/hello", (req, res) => {
  res.json({hello: "world!"});
});

// Define RelayRoom as "relay"
gameServer.define("relay", RelayRoom);

// Define ChatRoom as "chat"
gameServer.define("chat", ChatRoom)
  // demonstrating public events.
  .on("create", (room) => console.log("room created!", room.roomId))
  .on("join", (room, client) => console.log("client", client.sessionId, "joined", room.roomId))
  .on("leave", (room, client) => console.log("client", client.sessionId, "left", room.roomId))
  .on("dispose", (room) => console.log("room disposed!", room.roomId));

app.use(express.static(__dirname));

gameServer.onShutdown(() => {
  console.log("CUSTOM SHUTDOWN ROUTINE: STARTED");
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      console.log("CUSTOM SHUTDOWN ROUTINE: FINISHED");
      resolve();
    }, 1000);
  })
});

process.on('unhandledRejection', r => console.log(r));

gameServer.listen(port);

console.log(`Listening on ws://${ endpoint }:${ port }`)

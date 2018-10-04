//
// This example shows how to scale the Colyseus.Server.
//
// You must specify the `presence` option on Colyseus.Server when using multiple
// processes. This example uses Redis as presence server.
//

import * as http from "http";
import * as express from "express";
import * as bodyParser from "body-parser";

import { Server } from "../src/Server";
import { ChatRoom } from "./ChatRoom";
import { RedisPresence } from './../src/presence/RedisPresence';

const port = Number(process.env.PORT || 2657);
const endpoint = "localhost";

const app = express();

// Create HTTP & WebSocket servers
const server = http.createServer(app);
const gameServer = new Server({
  verifyClient: (info, next) => {
    // console.log("custom verifyClient!");
    next(true);
  },
  presence: new RedisPresence(),
  server: server
});

// Register ChatRoom as "chat"
gameServer.register("chat", ChatRoom).
  // demonstrating public events.
  on("create", (room) => console.log("handler: room created!", room.roomId)).
  on("join", (room, client) => console.log("handler: client", client.sessionId, "joined", room.roomId)).
  on("leave", (room, client) => console.log("handler: client", client.sessionId, "left", room.roomId)).
  on("dispose", (room) => console.log("handler: room disposed!", room.roomId));

app.use(express.static(__dirname));
app.use(bodyParser.json());

gameServer.listen(port);

console.log(`Listening on http://localhost:${ port }`)

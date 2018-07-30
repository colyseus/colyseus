import * as http from "http";
import * as express from "express";
import * as bodyParser from "body-parser";
// import * as WebSocket from "uws";

import { Server } from "../src/Server";
import { ChatRoom } from "./ChatRoom";

const port = Number(process.env.PORT || 2657);
const endpoint = "localhost";

const app = express();
app.use(bodyParser.json());

// Create HTTP & WebSocket servers
const server = http.createServer(app);
const gameServer = new Server({
  // engine: WebSocket.Server,
  server: server
});

// Register ChatRoom as "chat"
gameServer.register("chat", ChatRoom).
  // demonstrating public events.
  on("create", (room) => console.log("room created!", room.roomId)).
  on("join", (room, client) => console.log("client", client.id, "joined", room.roomId)).
  on("leave", (room, client) => console.log("client", client.id, "left", room.roomId)).
  on("dispose", (room) => console.log("room disposed!", room.roomId));

app.use(express.static(__dirname));

app.get("/something", (req, res) => {
  console.log("something!", process.pid);
  console.log("GET /something")
  res.send("Hey!");
});

app.post("/something", (req, res) => {
  console.log("POST /something")
  res.json(req.body);
});

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

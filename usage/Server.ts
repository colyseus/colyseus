import * as http from "http";
import * as express from "express";

import { Server } from "../src/Server";
import { ChatRoom } from "./ChatRoom";

const port = 8080;
const endpoint = "localhost";

const app = express();

// Create HTTP & WebSocket servers
const server = http.createServer(app);
const gameServer = new Server({ server: server });

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
  res.send("Hey!");
});

gameServer.listen(port);

console.log(`Listening on http://${ endpoint }:${ port }`)

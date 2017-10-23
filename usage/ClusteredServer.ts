import * as cluster from "cluster";
import * as path from 'path';
import * as express from 'express';

import { ClusterServer } from "../src/ClusterServer";
import { ChatRoom } from "./ChatRoom";

const PORT = 8080;

let gameServer = new ClusterServer();

if (cluster.isMaster) {
  gameServer.listen(PORT);
  gameServer.fork();

} else {
  const app = new express();

  app.get("/something", (req, res) => {
    console.log("something!", process.pid);
    res.send("Hey!");
  });

  // Register ChatRoom as "chat"
  gameServer.register("chat", ChatRoom).
    // demonstrating public events.
    on("create", (room) => console.log("room created!", room.roomId)).
    on("join", (room, client) => console.log("client", client.id, "joined", room.roomId)).
    on("leave", (room, client) => console.log("client", client.id, "left", room.roomId)).
    on("dispose", (room) => console.log("room disposed!", room.roomId));

  // Create HTTP Server
  gameServer.attach({ server: app });
}

console.log(`Listening on ${ PORT }`);

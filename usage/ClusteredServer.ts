import * as cluster from "cluster";
import * as path from 'path';
import * as express from 'express';
import * as bodyParser from "body-parser";

import { ClusterServer } from "../src/ClusterServer";
import { ChatRoom } from "./ChatRoom";

const PORT = 8080;

let gameServer = new ClusterServer();

if (cluster.isMaster) {
  gameServer.listen(PORT);
  gameServer.fork();

  gameServer.onShutdown(() => {
    console.log("CUSTOM SHUTDOWN ROUTINE MASTER: STARTED");
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        console.log("CUSTOM SHUTDOWN ROUTINE MASTER: FINISHED");
        resolve();
      }, 1000);
    })
  });

} else {
  const app = new express();

  app.use(bodyParser.json());

  app.on("close", () => console.log("express close!"));

  app.get("/something", (req, res) => {
    console.log("something!", process.pid);
    console.log("GET /something")
    res.send("Hey!");
  });

  app.post("/something", (req, res) => {
    console.log("POST /something")
    res.json(req.body);
  });

  // Register ChatRoom as "chat"
  gameServer.register("chat", ChatRoom).
    // demonstrating public events.
    on("create", (room) => console.log("room created!", room.roomId)).
    on("join", (room, client) => console.log("client", client.id, "joined", room.roomId)).
    on("leave", (room, client) => console.log("client", client.id, "left", room.roomId)).
    on("dispose", (room) => console.log("room disposed!", room.roomId));

  gameServer.onShutdown(() => {
    console.log("CUSTOM SHUTDOWN WORKER: STARTED");
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        console.log("CUSTOM SHUTDOWN WORKER: FINISHED");
        resolve();
      }, 1000);
    })
  });

  // Create HTTP Server
  gameServer.attach({ server: app });
}

console.log(`Listening on ${ PORT }`);

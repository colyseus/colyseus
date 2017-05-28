import * as cluster from "cluster";
import * as path from 'path';
import * as express from 'express';

import { ClusterServer } from "../src/ClusterServer";
import { ChatRoom } from "./ChatRoom";

let gameServer = new ClusterServer();

if (cluster.isMaster) {
  gameServer.listen(8080);

} else {
  console.log("Worker spawned");
  const app = new express();

  app.get("/something", (req, res) => {
    console.log("something!");
    res.send("Hey!");
  });

  // Create HTTP Server
  gameServer.attach({ server: app });

  // Register ChatRoom as "chat"
  gameServer.register("chat", ChatRoom);
}

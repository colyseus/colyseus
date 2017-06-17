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
gameServer.register("chat", ChatRoom);

app.use(express.static(__dirname));

app.get("/something", (req, res) => {
  console.log("something!", process.pid);
  res.send("Hey!");
});

gameServer.listen(port);

console.log(`Listening on http://${ endpoint }:${ port }`)

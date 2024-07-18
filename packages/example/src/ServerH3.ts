import http from "http";
import express from "express";

import { Server } from "@colyseus/core";
import { H3Transport } from "@colyseus/h3-transport";

import { MyRoom } from "./MyRoom";

const port = Number(process.env.PORT || 2567);
const endpoint = "localhost";

// Create HTTP & WebSocket servers
const app = express();
const server = http.createServer(app);

app.use(express.json());
app.get("/hello", (req, res) => {
  res.json({ hello: "world!" });
});

const transport = new H3Transport({ server, app });
const gameServer = new Server({ transport, });

gameServer.define("my_room", MyRoom);

gameServer.listen(port)
  .then(() => console.log(`Listening on https://${endpoint}:${port}`))
  .catch((err) => {
    console.log(err);
    process.exit(1)
  });


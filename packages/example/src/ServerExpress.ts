import http from "http";
import express from "express";

import { Server, RelayRoom, LobbyRoom } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { monitor } from "@colyseus/monitor";
// import { JWT } from "@colyseus/auth";

// import { MongooseDriver  } from "@colyseus/mongoose-driver";
// import { uWebSocketsTransport } from "@colyseus/uwebsockets-transport";

// import expressify from "uwebsockets-express";

import { MyRoom } from "./MyRoom";

const port = Number(process.env.PORT || 2567);
const endpoint = "localhost";

// Create HTTP & WebSocket servers
const app = express();
const server = http.createServer(app);
const transport = new WebSocketTransport({ server });

// const transport = new uWebSocketsTransport();
// const app = expressify(transport.app);

const gameServer = new Server({
  transport,

  // server: server,
  // presence: new RedisPresence(),
  // driver: new RedisDriver(),

  // devMode: true,

  // // driver: new MongooseDriver(),
  // publicAddress: `localhost:${port}`,
});

app.use(express.json());
app.get("/hello", (req, res) => {
  res.json({ hello: "world!" });
});

gameServer.define("my_room", MyRoom);
gameServer.define("lobby", LobbyRoom);

// Define RelayRoom as "relay"
gameServer.define("relay", RelayRoom)
  // demonstrating public events.
  .on("create", (room) => console.log("room created!", room.roomId))
  .on("join", (room, client) => console.log("client", client.sessionId, "joined", room.roomId))
  .on("leave", (room, client) => console.log("client", client.sessionId, "left", room.roomId))
  .on("dispose", (room) => console.log("room disposed!", room.roomId));

app.use(express.static(__dirname));
// app.use("/monitor", monitor());

gameServer.onShutdown(() => {
  console.log("CUSTOM SHUTDOWN ROUTINE: STARTED");

  return new Promise<void>((resolve, reject) => {
    setTimeout(() => {
      console.log("CUSTOM SHUTDOWN ROUTINE: FINISHED");
      resolve();
    }, 1000);
  })
});

// process.on('unhandledRejection', r => console.log('unhandledRejection...', r));

gameServer.listen(port)
  .then(() => console.log(`Listening on ws://${endpoint}:${port}`))
  .catch((err) => {
    console.log(err);
    process.exit(1)
  });


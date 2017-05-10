import * as express from "express";
import * as msgpack from "msgpack";
import * as cluster from "cluster";
import * as memshared from "memshared";

import { Server as WebSocketServer } from "uws";
import { Client, Protocol } from "../";

const app = new express();
const server = app.listen(0, "localhost")

let wss = new WebSocketServer({ server: server });
wss.on('connection', onConnect);

//
// Listen to "redirect" messages from main process, to redirect the connection
// to match-making process.
//
process.on('message', (message, connection) => {
  if (message !== "redirect") { return; }
  server.emit('connection', connection);
  connection.resume();
});

// Process spawned successfully!
console.log("MatchMaking process spawned.");

function onConnect (client: Client) {
  console.log("onConnect", client);

  client.on('message', (message) => {
    let message;

    // try to decode message received from client
    try {
      message = msgpack.decode(Buffer.from(data));

    } catch (e) {
      console.error("Couldn't decode message:", data, e.stack);
      return;
    }

    if (message[0] !== Protocol.JOIN_ROOM) {
      console.error("MatchMaking couldn't process message:", message);
      return;
    }

    // Request to join in existing sessions for requested room.
    memshared.smembers(message[1], (processIds) => {
      for (var i = 0, len = processIds.length; i < len; i++) {
        cluster.workers[processIds[i]].send(message);
      }
    });

  });

  client.on('error', (e) => {
    console.error("[ERROR]", client, e);
  });
}

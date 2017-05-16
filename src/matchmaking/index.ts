import * as express from "express";
import * as msgpack from "msgpack-lite";
import * as child_process from "child_process";
import * as memshared from "memshared";

import { Server as WebSocketServer } from "uws";
import { Client, Protocol } from "../";
import { ClusterProtocol } from "../ClusterServer";

const app = new express();
const server = app.listen(0, "localhost")

let wss = new WebSocketServer({ server: server });
wss.on('connection', onConnect);

//
// Listen to "redirect" messages from main process, to redirect the connection
// to match-making process.
//
process.on('message', (message, connection) => {
  if (message !== ClusterProtocol.BIND_CLIENT) {
    return;
  }

  server.emit('connection', connection);
  connection.resume();
});

// Process spawned successfully!
console.log("MatchMaking process spawned.");

function onConnect (client: Client) {
  console.log("onConnect", client);

  client.on('message', (message) => {
    // try to decode message received from client
    try {
      message = msgpack.decode(Buffer.from(message));

    } catch (e) {
      console.error("Couldn't decode message:", message, e.stack);
      return;
    }

    if (message[0] !== Protocol.JOIN_ROOM) {
      console.error("MatchMaking couldn't process message:", message);
      return;
    }

    memshared.lrange("workerIds", 0, -1, (err, workerIds) => {
      console.log("workerIds:", workerIds);
      console.log("request smembers", message[1]);

      // Request to join in existing sessions for requested room.
      memshared.smembers(message[1], (err, availableWorkerIds) => {
        let numAvaialbleWorkers = availableWorkerIds.length;
        console.log("numAvaialbleWorkers", numAvaialbleWorkers);

        if (numAvaialbleWorkers === 0) {
          // Find worker will lowest amount of sessions spawned

          memshared.mget(availableWorkerIds, (err, spawnedRooms) => {
            console.log("spawnedRooms", spawnedRooms);

            let selectedWorkerId = (spawnedRooms.length > 0)
              ? workerIds[ spawnedRooms.indexOf(Math.min(...spawnedRooms)) ]
              : workerIds[0];

            console.log("selectedWorkerId", selectedWorkerId);

            process.send([
              selectedWorkerId,
              ClusterProtocol.CREATE_ROOM,
              message[1],
              message[2]
            ]);
          });

        } else {

          console.log("broadcasting raw message to other processes", message);
          process.send(message);
        }
      });

    });


  });

  client.on('error', (e) => {
    console.error("[ERROR]", client, e);
  });
}

import * as express from "express";
import * as msgpack from "msgpack-lite";
import * as memshared from "memshared";
import { Server as WebSocketServer } from "uws";

import { Protocol, send } from "../Protocol";
import { Client, generateId } from "../";
import { handleUpgrade, setUserId } from "../cluster/Worker";

import { debugMatchMaking } from "../Debug";

const app = new express();
const server = app.listen(0, "localhost");

let wss = new WebSocketServer({
  server: server,
  verifyClient: function (info, done) {
    // console.log("Verify client!", info, done);
    done(true);
  }
});

// setInterval(() => console.log("MatchMaking connections:", wss.clients.length), 1000);

wss.on('connection', onConnect);

//
// Listen to "redirect" messages from main process, to redirect the connection
// to match-making process.
//
let callbacks: {[requestId:string]: Function} = {};
process.on('message', (message, socket) => {
  if (message[0] === Protocol.PASS_WEBSOCKET) {
    handleUpgrade(server, socket, message);
    return;

  } else if (Array.isArray(message) && callbacks[ message[0] ]) {
    let callback = callbacks[ message.shift() ];
    callback(...message);
    return;
  }
});

// Process spawned successfully!
debugMatchMaking("MatchMaking process spawned with pid %d", process.pid);

function onConnect (client: Client) {
  setUserId(client);

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

    let roomName = message[1];
    let joinOptions = message[2];

    // has room handler avaialble?
    memshared.lindex("handlers", roomName, (err, index) => {
      if (index === null) {
        send(client, [Protocol.JOIN_ERROR, roomName, `Error: no available handler for "${ roomName }"`]);
        return;
      }

      // Request to join an existing sessions for requested handler
      memshared.smembers(roomName, (err, availableWorkerIds) => {
        //
        // TODO:
        // remove a room from match-making cache when it reaches maxClients.
        //

        joinOptions.clientId = client.id;

        if (availableWorkerIds.length > 0) {
          broadcastJoinRoomRequest(availableWorkerIds, client, roomName, joinOptions);

        } else {
          // retrieve active worker ids
          requestCreateRoom(client, roomName, joinOptions);
        }
      });

    });

  });

  client.on('error', (e) => {
    console.error("[ERROR]", client, e);
  });
}

function broadcastJoinRoomRequest (availableWorkerIds: string[], client: Client, roomName: string, joinOptions: any) {
  let responsesReceived = [];

  callbacks[ client.id ] = (workerId, roomId, score) => {
    responsesReceived.push({
      roomId: roomId,
      score: score,
      workerId: workerId
    });

    debugMatchMaking("JOIN_ROOM, receiving responses (%d/%d)", responsesReceived.length, availableWorkerIds.length);

    if (responsesReceived.length === availableWorkerIds.length) {
      // sort responses by score
      responsesReceived.sort((a, b) => b.score - a.score);

      let { workerId, roomId, score } = responsesReceived[0];

      if (score === 0) {
        debugMatchMaking("JOIN_ROOM, best score: %d, (options: %j)", score, joinOptions);

        // highest score is 0, let's request to create a room instead of joining.
        requestCreateRoom(client, roomName, joinOptions);

      } else {
        debugMatchMaking("JOIN_ROOM, best score: %d, (options: %j)", score, joinOptions);

        // send join room request to worker id with best score
        joinRoomRequest(workerId, client, roomId, joinOptions);
      }
    }
  }

  availableWorkerIds.forEach(availableWorkerId => {
    // Send JOIN_ROOM command to selected worker process.
    process.send([ availableWorkerId, Protocol.REQUEST_JOIN_ROOM, roomName, joinOptions ]);
  });
}

function joinRoomRequest (workerId, client, roomName, joinOptions) {
  // forward data received from worker process to the client
  callbacks[ client.id ] = (data) => send(client, data);

  // Send JOIN_ROOM command to selected worker process.
  process.send([ workerId, Protocol.JOIN_ROOM, roomName, joinOptions ]);
}

function requestCreateRoom (client, roomName, joinOptions) {
  // forward data received from worker process to the client
  callbacks[ client.id ] = (data) => send(client, data);

  memshared.lrange("workerIds", 0, -1, (err, workerIds) => {
    memshared.mget(workerIds, (err, spawnedRoomCounts) => {
      spawnedRoomCounts = spawnedRoomCounts.filter(count => count);

      let selectedWorkerId = (spawnedRoomCounts.length > 0)
        ? workerIds[ spawnedRoomCounts.indexOf(Math.min(...spawnedRoomCounts)) ]
        : workerIds[0];

      debugMatchMaking("requesting CREATE_ROOM");

      // Send CREATE_ROOM command to selected worker process.
      process.send([ selectedWorkerId, Protocol.CREATE_ROOM, roomName, joinOptions ]);
    });
  });
}

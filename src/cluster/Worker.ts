import * as cluster from "cluster";
import * as memshared from "memshared";
import * as net from "net";
import * as http from "http";

import { Server as WebSocketServer } from "uws";
import { Protocol } from "../Protocol";
import { MatchMaker } from "../MatchMaker";
import { Client, Room } from "../";

export function handleUpgrade (wss: WebSocketServer, socket: net.Socket, message: any) {
  let [ code, request, head ] = message;
  request.connection = socket;

  // handle upgrade of the living web socket connection again,
  // in the worker node
  wss.handleUpgrade(request, socket, head, (client) => {
    wss.emit('connection', client, request);
  });

  socket.resume();
  return;
}

export function setupWorker (server: net.Server, matchMaker: MatchMaker) {
  let wss = new WebSocketServer({ server: server as http.Server });

  process.on('message', (message, socket) => {
    let roomNameOrId = message[1];
    let joinOptions = message[2];
    let allowCreateRoom = (message[0] === Protocol.CREATE_ROOM);

    if (message[0] === Protocol.PASS_HTTP_SOCKET) {
      server.emit('connection', socket);
      socket.resume();
      return;

    } else if (message[0] === Protocol.PASS_WEBSOCKET) {
      handleUpgrade(wss, socket, message);
      return;

    } else if (allowCreateRoom || message[0] === Protocol.JOIN_ROOM) {
      matchMaker.onJoinRoomRequest(roomNameOrId, joinOptions, allowCreateRoom, (err: string, room: Room<any>) => {
        let joinRoomResponse;

        if (err) {
          joinRoomResponse = [ Protocol.JOIN_ERROR, roomNameOrId, err ];

        } else {
          joinRoomResponse = [ Protocol.JOIN_ROOM, room.roomId ];
        }

        // send response back to match-making process.
        memshared.get("matchmaking_process", (err, matchMakingPid) => {
          console.log("send back to matchmaking process...", matchMakingPid);
          process.send([matchMakingPid, joinOptions.clientId, joinRoomResponse]);
        });
      });
    }

  });

  return server;
}

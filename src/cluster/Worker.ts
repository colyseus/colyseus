import * as cluster from "cluster";
import * as memshared from "memshared";
import * as net from "net";

import { Protocol } from "../Protocol";
import { MatchMaker } from "../MatchMaker";
import { Client, Room } from "../";

export function setupWorker (server: net.Server, matchMaker: MatchMaker) {
  process.on('message', (message) => {
    let roomNameOrId = message[1];
    let joinOptions = message[2];
    let allowCreateRoom = (message[0] === Protocol.CREATE_ROOM);

    if (allowCreateRoom || message[0] === Protocol.JOIN_ROOM) {
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


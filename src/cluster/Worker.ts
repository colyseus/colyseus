import * as cluster from "cluster";
import * as memshared from "memshared";
import * as net from "net";

import { Protocol } from "../Protocol";
import { MatchMaker } from "../MatchMaker";
import { Client, Room } from "../";

export function setupWorker (server: net.Server, matchMaker: MatchMaker) {
  process.on('message', (message) => {
    console.log("worker received message:", message);
    let roomNameOrId = message[1];
    let joinOptions = message[2];
    let requestId = message[3];

    if (message[0] === Protocol.JOIN_ROOM) {
      matchMaker.onJoinRoomRequest(roomNameOrId, joinOptions, (err: string, room: Room<any>) => {
        let joinRoomResponse;
        if (err) {
          joinRoomResponse = [ Protocol.JOIN_ERROR, roomNameOrId, err ];

          // client.send(msgpack.encode(), { binary: true });
          // if (room) { (<any>room)._onLeave(client); }
        } else {
          joinRoomResponse = [ Protocol.JOIN_ROOM, room.roomId ];
        }

        // send response back to match-making process.
        memshared.get("matchmaking_process", (err, matchMakingPid) => {
          console.log("send back to matchmaking process...", matchMakingPid);
          process.send([matchMakingPid, requestId, joinRoomResponse]);
        });
      });
    }

  });

  return server;
}


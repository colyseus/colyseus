import * as cluster from "cluster";
import * as memshared from "memshared";
import * as net from "net";
import * as http from "http";
import * as msgpack from "msgpack-lite";
import * as cookie from "cookie";

import { Server as WebSocketServer } from "uws";
import { Protocol } from "../Protocol";
import { MatchMaker } from "../MatchMaker";
import { Client, Room, generateId } from "../";

/**
 * Retrieve and/or set 'colyseusid' cookie.
 */
export function setUserId (client: Client) {
  let clientCookies = cookie.parse(client.upgradeReq.headers.cookie);
  client.id = clientCookies['colyseusid'] || generateId();

  if (!clientCookies['colyseusid']) {
    client.send( msgpack.encode([ Protocol.USER_ID, client.id ]), { binary: true } );
  }
}

export function handleUpgrade (server: http.Server, socket: net.Socket, message: any) {
  let code = message[0];
  let request: http.ServerRequest = message[1];
  let head: any = message[2];
  let roomId: any = message[3];

  // assign client socket to request
  request.connection = socket;
  (<any>request).roomId = roomId;

  // handle 'upgrade' of the WebSocket connection in the worker node
  server.emit('upgrade', request, socket, head);

  socket.resume();
}

export function setupWorker (server: net.Server, matchMaker: MatchMaker) {
  let wss = new WebSocketServer({ server: server as http.Server });

  wss.on("connection", (client: Client) => {
    setUserId(client);

    let roomId = (<any>client.upgradeReq).roomId;

    matchMaker.onJoin(roomId, client, (err, room) => {
      if (!err) {
        client.on('message', (message) => {
          // TODO: unify this with matchmaking/Process
          try {
            // try to decode message received from client
            message = msgpack.decode(Buffer.from(message));

          } catch (e) {
            console.error("Couldn't decode message:", message, e.stack);
            return;
          }

          matchMaker.execute(client, message);
        });
        client.on('error', (e) => console.error("[ERROR]", client.id, e));
        client.on('close', () => matchMaker.disconnect(client));
      }
    });
  });

  process.on('message', (message, socket) => {
    let roomNameOrId = message[1];
    let joinOptions = message[2];
    let allowCreateRoom = (message[0] === Protocol.CREATE_ROOM);

    if (message[0] === Protocol.PASS_HTTP_SOCKET) {
      server.emit('connection', socket);
      socket.resume();
      return;

    } else if (message[0] === Protocol.PASS_WEBSOCKET) {
      handleUpgrade(server as http.Server, socket, message);
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



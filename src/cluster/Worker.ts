import * as memshared from "memshared";
import * as net from "net";
import * as http from "http";
import * as msgpack from "msgpack-lite";
import * as parseURL from "url-parse";

import { Server as WebSocketServer } from "uws";
import { Protocol } from "../Protocol";
import { MatchMaker } from "../MatchMaker";
import { Client, Room, generateId } from "../";

/**
 * Retrieve and/or set 'colyseusid' cookie.
 */
export function setUserId (client: Client) {
  let url = (<any>client.upgradeReq).url;

  client.id = url.query['colyseusid'] || generateId();

  if (!url.query['colyseusid']) {
    client.send( msgpack.encode([ Protocol.USER_ID, client.id ]), { binary: true } );
  }
}

export function handleUpgrade (server: http.Server, socket: net.Socket, message: any) {
  let code = message[0];
  let upgradeReq: http.ServerRequest = message[1];
  let head: any = message[2];

  let url: any = parseURL(message[3], true);
  (<any>upgradeReq).url = url;
  (<any>upgradeReq).roomId = url.pathname.substr(1);

  // assign client socket to request
  upgradeReq.connection = socket;

  // handle 'upgrade' of the WebSocket connection in the worker node
  server.emit('upgrade', upgradeReq, socket, head);

  socket.resume();
}

export function setupWorker (server: net.Server, matchMaker: MatchMaker) {
  let wss = new WebSocketServer({ server: server as http.Server });

  // setInterval(() => console.log(`worker ${ process.pid } connections:`, wss.clients.length), 1000);

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

        client.on('close', () => {
          matchMaker.onLeave(client, room)
        });

        client.on('error', (e) => {
          console.error("[ERROR]", client.id, e)
        });
      }
    });
  });

  process.on('message', (message, socket) => {
    let roomNameOrId = message[1];
    let joinOptions = message[2];
    let allowCreateRoom = (message[0] === Protocol.CREATE_ROOM);

    if (message[0] === Protocol.PASS_HTTP_SOCKET) {
      server.emit('connection', socket);

      // re-create request for incoming socket
      let request: any = new (<any>http).ClientRequest();
      request.headers = message[1].headers;
      request.method = message[1].method;
      request.url = message[1].url;
      request.connection = socket;
      request._readableState = socket._readableState;

      // TODO / FIXME:
      //
      // should we flush something here?
      // '_flush' method has been lost after redirecting the socket
      //
      request._flush = function() {};

      // emit request to server
      socket.parser.onIncoming(request);
      socket.resume();

      // This is way too hacky.
      request.emit('data', message[1].body);
      request.emit('end');

      return;

    } else if (message[0] === Protocol.PASS_WEBSOCKET) {
      handleUpgrade(server as http.Server, socket, message);
      return;

    } else if (message[0] === Protocol.REQUEST_JOIN_ROOM) {
      let { room, score } = matchMaker.requestToJoinRoom(message[1], message[2]);

      // send response back to match-making process.
      getMatchMakingProcess(matchMakingPid => {
        console.log("process", process.pid, "is responding to REQUEST_JOIN_ROOM");
        process.send([matchMakingPid, joinOptions.clientId, process.pid, room.roomId, score]);
      });

    } else if (allowCreateRoom || message[0] === Protocol.JOIN_ROOM) {
      matchMaker.onJoinRoomRequest(roomNameOrId, joinOptions, allowCreateRoom, (err: string, room: Room<any>) => {
        let joinRoomResponse;

        if (err) {
          joinRoomResponse = [ Protocol.JOIN_ERROR, roomNameOrId, err ];

        } else {
          joinRoomResponse = [ Protocol.JOIN_ROOM, room.roomId ];
        }

        // send response back to match-making process.
        getMatchMakingProcess(matchMakingPid => {
          process.send([matchMakingPid, joinOptions.clientId, joinRoomResponse]);
        });
      });

    }

  });

  return server;
}

function getMatchMakingProcess (callback: (matchMakingPid) => void) {
  memshared.get("matchmaking_process", (err, matchMakingPid) => {
    callback(matchMakingPid);
  });
}

import * as memshared from "memshared";
import * as net from "net";
import * as http from "http";
import * as msgpack from "notepack.io";
import * as parseURL from "url-parse";

import { Server as WebSocketServer } from "uws";
import { Protocol, send } from "../Protocol";
import { MatchMaker } from "../MatchMaker";
import { Client, Room, generateId } from "../";
import { debugMatchMaking } from "../Debug";

/**
 * Retrieve and/or set 'colyseusid' cookie.
 */
export function setUserId (client: Client) {
  let url = (<any>client.upgradeReq).url;

  client.id = url.query['colyseusid'] || generateId();

  if (!url.query['colyseusid']) {
    send(client, [ Protocol.USER_ID, client.id ]);
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
    matchMaker.bindClient(client, roomId);
  });

  process.on('message', (message, socket) => {
    let roomNameOrId = message[1];
    let joinOptions = message[2];
    let allowCreateRoom = (message[0] === Protocol.CREATE_ROOM);

    if (message[0] === Protocol.PASS_HTTP_SOCKET) {
      server.emit('connection', socket);

      // re-create request for incoming socket
      let request: any = new (<any>http).ClientRequest({ port: server.address().port });
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
      request._dump = function() {};

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
      let roomId = room && room.roomId;

      // send response back to match-making process.
      getMatchMakingProcess(matchMakingPid => {
        debugMatchMaking("worker '%s' is responding to REQUEST_JOIN_ROOM. (roomId: %s, score: %d)", process.pid, roomId, score);
        process.send([matchMakingPid, joinOptions.clientId, process.pid, roomId, score]);
      });

    } else if (allowCreateRoom || message[0] === Protocol.JOIN_ROOM) {
      matchMaker.onJoinRoomRequest(roomNameOrId, joinOptions, allowCreateRoom, (err: string, room: Room<any>) => {
        let joinRoomResponse = (err)
          ? [ Protocol.JOIN_ERROR, roomNameOrId, err ]
          : [ Protocol.JOIN_ROOM, room.roomId, joinOptions.requestId ];

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

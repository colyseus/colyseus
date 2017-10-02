import * as net from "net";
import * as http from "http";
import * as memshared from "memshared";
import * as msgpack from "msgpack-lite";
import * as parseURL from "url-parse";

import { Server as WebSocketServer, IServerOptions } from "uws";
import { MatchMaker } from "./MatchMaker";
import { Protocol, send } from "./Protocol";
import { Client } from "./index";
import { handleUpgrade, setUserId } from "./cluster/Worker";
import { Room } from "./Room";

export type ServerOptions = IServerOptions & {
  ws?: WebSocketServer
};

export class Server {
  protected server: WebSocketServer;
  protected httpServer: net.Server | http.Server;

  protected matchMaker: MatchMaker = new MatchMaker();

  constructor (options?: ServerOptions) {
    if (options.server) {
      this.attach({ server: options.server as http.Server });
    }
  }

  attach (options: ServerOptions) {
    if (options.server || options.port) {
      this.server = new WebSocketServer(options);
      this.httpServer = options.server;

    } else {
      this.server = options.ws;
    }

    this.server.on('connection', this.onConnection);
  }

  listen (port: number, hostname?: string, backlog?: number, listeningListener?: Function) {
    this.httpServer.listen(port, hostname, backlog, listeningListener);
  }

  register (name: string, handler: Function, options: any = {}) {
    this.matchMaker.addHandler(name, handler, options);
  }

  onConnection = (client: Client) => {
    // TODO: DRY (Worker.ts)
    // ensure URL is parsed.
    let url = parseURL((<any>client.upgradeReq).url, true);
    (<any>client.upgradeReq).url = url;
    (<any>client.upgradeReq).roomId = url.pathname.substr(1);

    setUserId(client);

    let roomId = (<any>client.upgradeReq).roomId;

    if (roomId) {
      this.matchMaker.bindClient(client, roomId);

    } else {
      client.on("message",  this.onMessageMatchMaking.bind(this, client));
    }

  }

  onMessageMatchMaking (client: Client, message) {
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

    joinOptions.clientId = client.id;

    if (!this.matchMaker.hasHandler(roomName)) {
      send(client, [Protocol.JOIN_ERROR, roomName, `Error: no available handler for "${ roomName }"`]);

    } else {
      this.matchMaker.onJoinRoomRequest(roomName, joinOptions, true, (err: string, room: Room<any>) => {
        let joinRoomResponse = (err)
          ? [ Protocol.JOIN_ERROR, roomName, err ]
          : [ Protocol.JOIN_ROOM, room.roomId ];

        send(client, joinRoomResponse);
      });
    }

  }

}

import * as net from "net";
import * as http from "http";
import * as memshared from "memshared";
import * as msgpack from "notepack.io";
import * as parseURL from "url-parse";

import { WebSocketServer, IServerOptions } from "./ws";
import { MatchMaker, RegisteredHandler } from "./MatchMaker";
import { Protocol, send, decode } from "./Protocol";
import { Client } from "./index";
import { handleUpgrade, setUserId } from "./cluster/Worker";
import { Room } from "./Room";
import { registerGracefulShutdown } from "./Utils";

export type ServerOptions = IServerOptions & {
  ws?: WebSocketServer
};

export class Server {
  protected server: WebSocketServer;
  protected httpServer: net.Server | http.Server;

  protected matchMaker: MatchMaker = new MatchMaker();
  protected _onShutdown: () => void | Promise<any> = () => Promise.resolve();

  constructor (options?: ServerOptions) {
    registerGracefulShutdown((signal) => {
      this.matchMaker.gracefullyShutdown().
        then(() => this._onShutdown()).
        catch((err) => console.log("ERROR!", err)).
        then(() => process.exit());
    });

    if (options.server) {
      this.attach({ server: options.server as http.Server });
    }
  }

  attach (options: ServerOptions) {
    if (options.server || options.port) {
      this.server = new (WebSocketServer as any)(options);
      this.httpServer = options.server;

    } else {
      this.server = options.ws;
    }

    this.server.on('connection', this.onConnection);
  }

  listen (port: number, hostname?: string, backlog?: number, listeningListener?: Function) {
    this.httpServer.listen(port, hostname, backlog, listeningListener);
  }

  register (name: string, handler: Function, options: any = {}): RegisteredHandler {
    return this.matchMaker.registerHandler(name, handler, options);
  }

  onShutdown (callback: () => void | Promise<any>) {
    this._onShutdown = callback;
  }

  onConnection = (client: Client, req?: http.IncomingMessage) => {
    //
    // TODO: DRY (Worker.ts)
    // ensure URL is parsed.
    //
    // compatibility with ws@3.x.x / uws
    if (req) {
      client.upgradeReq = req;
    }

    let url = parseURL((<any>client.upgradeReq).url, true);
    client.upgradeReq.url = url;
    (<any>client.upgradeReq).roomId = url.pathname.substr(1);

    setUserId(client);

    let roomId = (<any>client.upgradeReq).roomId;

    if (roomId) {
      this.matchMaker.bindClient(client, roomId);

    } else {
      client.on("message",  this.onMessageMatchMaking.bind(this, client));

      // since ws@3.3.3 it's required to listen to 'error' to prevent server crash
      // https://github.com/websockets/ws/issues/1256
      client.on('error', (e) => {/*console.error("[ERROR]", e);*/ });
    }
  }

  onMessageMatchMaking (client: Client, message) {
    if (!(message = decode(message))) {
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
          : [ Protocol.JOIN_ROOM, room.roomId, joinOptions.requestId ];

        send(client, joinRoomResponse);
      });
    }

  }

}
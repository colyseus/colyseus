import * as net from "net";
import * as http from "http";
import * as msgpack from "notepack.io";
import * as parseURL from "url-parse";
import * as WebSocket from "ws";
import { ServerOptions as IServerOptions } from "ws";

import { MatchMaker, RegisteredHandler } from "./MatchMaker";
import { Protocol, send, decode } from "./Protocol";
import { Client, isValidId, generateId } from "./index";
import { Room } from "./Room";
import { registerGracefulShutdown } from "./Utils";
import { Presence } from "./presence/Presence";

export type ServerOptions = IServerOptions & {
  presence?: any,
  engine?: any,
  ws?: any
};

export class Server {
  protected server: any;
  protected httpServer: net.Server | http.Server;

  protected presence: Presence;
  protected matchMaker: MatchMaker;

  protected _onShutdown: () => void | Promise<any> = () => Promise.resolve();

  constructor (options: ServerOptions = {}) {
    this.presence = options.presence;
    this.matchMaker = new MatchMaker(this.presence);

    registerGracefulShutdown((signal) => {
      this.matchMaker.gracefullyShutdown().
        then(() => this._onShutdown()).
        catch((err) => console.log("ERROR!", err)).
        then(() => process.exit());
    });

    if (options.server) {
      this.attach(options);
    }
  }

  attach (options: ServerOptions) {
    delete options.presence;

    if (options.server || options.port) {
      let engine = options.engine || WebSocket.Server;
      delete options.engine;

      this.server = new engine(options);
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

  onConnection = (client: Client, req?: http.IncomingMessage & any) => {
    // compatibility with ws / uws
    const upgradeReq = req || client.upgradeReq;

    const url = parseURL(upgradeReq.url, true);
    const roomId = url.pathname.substr(1);

    // set client id
    client.id = url.query['colyseusid'] || generateId();

    if (!url.query['colyseusid']) {
      send(client, [Protocol.USER_ID, client.id]);
    }

    if (roomId) {
      this.matchMaker.bindClient(client, roomId);

    } else {
      client.on("message",  this.onMessageMatchMaking.bind(this, client));
    }
  }

  protected onMessageMatchMaking (client: Client, message) {
    if (!(message = decode(message))) {
      return;
    }

    if (message[0] !== Protocol.JOIN_ROOM) {
      console.error("MatchMaking couldn't process message:", message);
      return;
    }

    console.log("onMessageMatchMaking", process.pid, message);

    const roomName = message[1];
    const joinOptions = message[2];

    joinOptions.clientId = client.id;

    if (!this.matchMaker.hasHandler(roomName) && !isValidId(roomName)) {
      send(client, [Protocol.JOIN_ERROR, roomName, `Error: no available handler for "${ roomName }"`]);

    } else {
      this.matchMaker.onJoinRoomRequest(roomName, joinOptions).
        then((room: Room) => send(client, [Protocol.JOIN_ROOM, room.roomId, joinOptions.requestId])).
        catch(err => send(client, [Protocol.JOIN_ERROR, roomName, err.message]));
    }

  }

}
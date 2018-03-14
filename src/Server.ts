import * as net from "net";
import * as http from "http";
import * as msgpack from "notepack.io";
import * as parseURL from "url-parse";
import * as WebSocket from "ws";
import { ServerOptions as IServerOptions } from "ws";
import { unescape } from "querystring";

import { MatchMaker, RegisteredHandler } from "./MatchMaker";
import { Protocol, send, decode } from "./Protocol";
import { Client, isValidId, generateId } from "./index";
import { Room } from "./Room";
import { registerGracefulShutdown } from "./Utils";
import { Presence } from "./presence/Presence";

export type ServerOptions = IServerOptions & {
  verifyClient?: WebSocket.VerifyClientCallbackAsync
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

    // "presence" option is not used from now on
    delete options.presence;

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

  public attach (options: ServerOptions) {
    const engine = options.engine || WebSocket.Server;
    delete options.engine;

    if (options.server || options.port) {
      const customVerifyClient: WebSocket.VerifyClientCallbackAsync = options.verifyClient;

      options.verifyClient = (info, next) =>  {
        if (!customVerifyClient) return this.verifyClient(info, next);

        customVerifyClient(info, (verified, code, message) => {
          if (!verified) return next(verified, code, message);

          this.verifyClient(info, next);
        });
      };

      this.server = new engine(options);
      this.httpServer = options.server;

    } else {
      this.server = options.ws;
    }

    this.server.on('connection', this.onConnection);
  }

  public listen (port: number, hostname?: string, backlog?: number, listeningListener?: Function) {
    this.httpServer.listen(port, hostname, backlog, listeningListener);
  }

  public register (name: string, handler: Function, options: any = {}): RegisteredHandler {
    return this.matchMaker.registerHandler(name, handler, options);
  }

  public onShutdown (callback: () => void | Promise<any>) {
    this._onShutdown = callback;
  }

  protected verifyClient = async (info, next) => {
    const req = info.req;
    const url = parseURL(req.url);
    req.roomId = url.pathname.substr(1);

    const query = JSON.parse(unescape(url.query.substr(1)));
    req.colyseusid = query['colyseusid'];

    delete query['colyseusid'];
    req.options = query;

    if (req.roomId) {
      this.matchMaker.remoteRoomCall(req.roomId, "verifyClient", [req.options]).
        then((result) => {
          req.verifyClient = result;
          next(true);
        }).
        catch((e) => {
          console.error("ERROR: verifyClient", e)
          next(false);
        });

      console.log("let's validate this client to connect into:", req.roomId);

    } else {
      next(true);
    }
  }

  protected onConnection = (client: Client, req?: http.IncomingMessage & any) => {
    // compatibility with ws / uws
    const upgradeReq = req || client.upgradeReq;

    // set client id
    client.id = upgradeReq.colyseusid || generateId();

    // ensure client has its "colyseusid"
    if (!upgradeReq.colyseusid) {
      send(client, [Protocol.USER_ID, client.id]);
    }

    // set client options
    client.options = upgradeReq.options;

    if (upgradeReq.roomId) {
      this.matchMaker.bindRoom(client, upgradeReq.roomId);

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
      this.matchMaker.onJoinRoomRequest(client, roomName, joinOptions).
        then((room: Room) => send(client, [Protocol.JOIN_ROOM, room.roomId, joinOptions.requestId])).
        catch(e => {
          console.log("onJoinRoomRequest error", e);
          send(client, [Protocol.JOIN_ERROR, roomName, e.message])
        });
    }
  }

}
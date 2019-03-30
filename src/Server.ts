import http from 'http';
import net from 'net';
import parseURL from 'url-parse';
import WebSocket from 'ws';
import { ServerOptions as IServerOptions } from 'ws';

import { debugAndPrintError, debugError } from './Debug';
import { MatchMaker, REMOTE_ROOM_LARGE_TIMEOUT } from './MatchMaker';
import { RegisteredHandler } from './matchmaker/RegisteredHandler';
import { Presence } from './presence/Presence';

import { MatchMakeError } from './Errors';
import { Client, generateId, isValidId } from './index';
import { decode, Protocol, send } from './Protocol';
import { RoomConstructor } from './Room';
import { parseQueryString, registerGracefulShutdown, retry } from './Utils';

function noop() {/* tslint:disable:no-empty */}
function heartbeat() { this.pingCount = 0; }

export type ServerOptions = IServerOptions & {
  pingTimeout?: number,
  verifyClient?: WebSocket.VerifyClientCallbackAsync
  presence?: any,
  engine?: any,
  ws?: any,
  gracefullyShutdown?: boolean,
};

export class Server {
  public matchMaker: MatchMaker;

  protected server: WebSocket.Server;
  protected httpServer: net.Server | http.Server;

  protected presence: Presence;
  protected pingInterval: NodeJS.Timer;
  protected pingTimeout: number;

  constructor(options: ServerOptions = {}) {
    const { gracefullyShutdown = true } = options;

    this.presence = options.presence;
    this.matchMaker = new MatchMaker(this.presence);
    this.pingTimeout = (options.pingTimeout !== undefined)
      ? options.pingTimeout
      : 1500;

    // "presence" option is not used from now on
    delete options.presence;

    if (gracefullyShutdown) {
      registerGracefulShutdown((signal) => this.gracefullyShutdown());
    }

    if (options.server) {
      this.attach(options);
    }
  }

  public attach(options: ServerOptions) {
    const engine = options.engine || WebSocket.Server;
    delete options.engine;

    if (options.server || options.port) {
      const customVerifyClient: WebSocket.VerifyClientCallbackAsync = options.verifyClient;

      options.verifyClient = (info, next) => {
        if (!customVerifyClient) { return this.verifyClient(info, next); }

        customVerifyClient(info, (verified, code, message) => {
          if (!verified) { return next(verified, code, message); }

          this.verifyClient(info, next);
        });
      };

      this.server = new engine(options);
      this.httpServer = options.server;

    } else {
      this.server = options.ws;
    }

    this.server.on('connection', this.onConnection);

    if (this.pingTimeout > 0) {
      this.autoTerminateUnresponsiveClients(this.pingTimeout);
    }
  }

  public listen(port: number, hostname?: string, backlog?: number, listeningListener?: Function) {
    this.httpServer.listen(port, hostname, backlog, listeningListener);
  }

  public async register(name: string, handler: RoomConstructor, options: any = {}): Promise<RegisteredHandler> {
    return this.matchMaker.registerHandler(name, handler, options);
  }

  public gracefullyShutdown(exit: boolean = true) {
    return this.matchMaker.gracefullyShutdown().
      then(() => {
        clearInterval(this.pingInterval);
        return this.onShutdownCallback();
      }).
      catch((err) => debugAndPrintError(`error during shutdown: ${err}`)).
      then(() => {
        if (exit) { process.exit(); }
      });
  }

  public onShutdown(callback: () => void | Promise<any>) {
    this.onShutdownCallback = callback;
  }

  protected onShutdownCallback: () => void | Promise<any> =
    () => Promise.resolve()

  protected autoTerminateUnresponsiveClients(pingTimeout: number) {
      // interval to detect broken connections
      this.pingInterval = setInterval(() => {
        this.server.clients.forEach((client: Client) => {
          //
          // if client hasn't responded after the interval, terminate its connection.
          //
          if (client.pingCount >= 2) {
            return client.terminate();
          }

          client.pingCount++;
          client.ping(noop);
        });
      }, pingTimeout);
  }

  protected verifyClient = async (info, next) => {
    const req = info.req;

    const url = parseURL(req.url);
    req.roomId = url.pathname.substr(1);

    const query = parseQueryString(url.query);
    req.colyseusid = query.colyseusid;

    delete query.colyseusid;
    req.options = query;

    if (req.roomId) {
      try {
        // TODO: refactor me. this piece of code is repeated on MatchMaker class.
        const hasReservedSeat = query.sessionId && await this.matchMaker.remoteRoomCall(
          req.roomId,
          'hasReservedSeat',
          [query.sessionId],
        );

        if (!hasReservedSeat) {
          const isLocked = await this.matchMaker.remoteRoomCall(req.roomId, 'locked');

          if (isLocked) {
            return next(false, Protocol.WS_TOO_MANY_CLIENTS, 'maxClients reached.');
          }
        }

        // verify client from room scope.
        const authResult = await this.matchMaker.remoteRoomCall(
          req.roomId,
          'onAuth',
          [req.options],
          REMOTE_ROOM_LARGE_TIMEOUT,
        );

        if (authResult) {
          req.auth = authResult;
          next(true);

        } else {
          throw new Error('onAuth failed.');
        }

      } catch (e) {
        if (e) { // user might have called `reject()` during onAuth without arguments.
          debugAndPrintError(e.message + '\n' + e.stack);
        }

        next(false);
      }

    } else {
      next(true);
    }
  }

  protected onConnection = (client: Client, req?: http.IncomingMessage & any) => {
    // compatibility with ws / uws
    const upgradeReq = req || client.upgradeReq;

    // set client id
    client.id = upgradeReq.colyseusid || generateId();
    client.pingCount = 0;

    // ensure client has its "colyseusid"
    if (!upgradeReq.colyseusid) {
      send[Protocol.USER_ID](client);
    }

    // set client options
    client.options = upgradeReq.options;
    client.auth = upgradeReq.auth;

    // prevent server crashes if a single client had unexpected error
    client.on('error', (err) => debugAndPrintError(err.message + '\n' + err.stack));
    client.on('pong', heartbeat);

    const roomId = upgradeReq.roomId;
    if (roomId) {
      this.matchMaker.connectToRoom(client, upgradeReq.roomId).
        catch((e) => {
          debugAndPrintError(e.stack || e);
          send[Protocol.JOIN_ERROR](client, (e && e.message) || '');
        });

    } else {
      client.on('message',  this.onMessageMatchMaking.bind(this, client));
    }
  }

  protected onMessageMatchMaking(client: Client, message) {
    message = decode(message);

    if (!message) {
      debugAndPrintError(`couldn't decode message: ${message}`);
      return;
    }

    if (message[0] === Protocol.JOIN_REQUEST) {
      const roomName = message[1];
      const joinOptions = message[2];

      joinOptions.clientId = client.id;

      if (!this.matchMaker.hasHandler(roomName) && !isValidId(roomName)) {
        send[Protocol.JOIN_ERROR](client, `no available handler for "${roomName}"`);

      } else {
        //
        // As a room might stop responding during the matchmaking process, due to it being disposed.
        // The last step of the matchmaking will make sure a seat will be reserved for this client
        // If `onJoinRoomRequest` can't make it until the very last step, a retry is necessary.
        //
        retry(() => {
          return this.matchMaker.onJoinRoomRequest(client, roomName, joinOptions);
        }, 3, 0, [MatchMakeError]).
          then((response: {roomId: string, processId: string}) => {
            send[Protocol.JOIN_REQUEST](client, joinOptions.requestId, response.roomId, response.processId);

          }).catch((e) => {
            const errorMessage = (e && e.message) || '';
            debugError(`MatchMakeError: ${errorMessage}\n${e.stack}`);

            send[Protocol.JOIN_ERROR](client, errorMessage);
          });
      }

    } else if (message[0] === Protocol.ROOM_LIST) {
      const requestId = message[1];
      const roomName = message[2];

      this.matchMaker.getAvailableRooms(roomName).
        then((rooms) => send[Protocol.ROOM_LIST](client, requestId, rooms)).
        catch((e) => debugAndPrintError(e.stack || e));

    } else {
      debugAndPrintError(`MatchMaking couldn\'t process message: ${message}`);
    }

  }

}

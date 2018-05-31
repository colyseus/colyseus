import * as http from 'http';
import * as net from 'net';
import * as msgpack from 'notepack.io';
import * as WebSocket from 'ws';
import { ServerOptions as IServerOptions } from 'ws';

import { debugError } from './Debug';
import { MatchMaker } from './MatchMaker';
import { RegisteredHandler } from './matchmaker/RegisteredHandler';
import { Presence } from './presence/Presence';
import { Transport, TCPTransport, WebSocketTransport } from './transport/Transport';

import { Client, generateId, isValidId } from './index';
import { decode, Protocol, send } from './Protocol';
import { Room, RoomConstructor } from './Room';
import { registerGracefulShutdown } from './Utils';

export type ServerOptions = IServerOptions & {
  verifyClient?: WebSocket.VerifyClientCallbackAsync
  presence?: any,
  engine?: any,
  ws?: any,
};

export class Server {
  public matchMaker: MatchMaker;

  protected transport: Transport;
  protected presence: Presence;

  protected onShutdownCallback: () => void | Promise<any>;

  constructor(options: ServerOptions = {}) {
    this.presence = options.presence;
    this.matchMaker = new MatchMaker(this.presence);

    this.onShutdownCallback = () => Promise.resolve();

    // "presence" option is not used from now on
    delete options.presence;

    registerGracefulShutdown((signal) => {
      this.matchMaker.gracefullyShutdown().
        then(() => this.shutdown()).
        catch((err) => debugError(`error during shutdown: ${err}`)).
        then(() => process.exit());
    });

    this.attach(options);
  }

  public attach(options: ServerOptions) {
    const engine = options.engine || WebSocket.Server;
    delete options.engine;

    this.transport = (engine === net.Server)
      ? new TCPTransport(this.matchMaker, options)
      : new WebSocketTransport(this.matchMaker, options, engine);
  }

  public listen(port: number, hostname?: string, backlog?: number, listeningListener?: Function) {
    this.transport.listen(port, hostname, backlog, listeningListener);
  }

  public register(name: string, handler: RoomConstructor, options: any = {}): RegisteredHandler {
    return this.matchMaker.registerHandler(name, handler, options);
  }

  public onShutdown(callback: () => void | Promise<any>) {
    this.onShutdownCallback = callback;
  }

  protected shutdown()  {
    return this.onShutdownCallback();
  }

}

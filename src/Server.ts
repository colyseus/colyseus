import net from 'net';
import WebSocket from 'ws';
import { ServerOptions as IServerOptions } from 'ws';

import { debugAndPrintError } from './Debug';
import { MatchMaker } from './MatchMaker';
import { RegisteredHandler } from './matchmaker/RegisteredHandler';
import { Presence } from './presence/Presence';
import { Transport, TCPTransport, WebSocketTransport } from './transport/Transport';

import { RoomConstructor } from './Room';
import { registerGracefulShutdown } from './Utils';

import { registerNode, unregisterNode } from './discovery';
import { LocalPresence } from './presence/LocalPresence';
import { generateId } from '.';

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

  protected transport: Transport;
  protected presence: Presence;

  protected processId: string = generateId();

  constructor(options: ServerOptions = {}) {
    const { gracefullyShutdown = true } = options;

    this.presence = options.presence || new LocalPresence();
    this.matchMaker = new MatchMaker(this.presence, this.processId);

    // "presence" option is not used from now on
    delete options.presence;

    if (gracefullyShutdown) {
      registerGracefulShutdown((signal) => this.gracefullyShutdown());
    }

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
    this.transport.listen(port, hostname, backlog, () => {
      if (listeningListener) listeningListener();
        // register node for proxy/service discovery
        registerNode(this.presence, {
            addressInfo: this.transport.address() as net.AddressInfo,
            processId: this.processId,
        });
      
    });
  }

  public async register(name: string, handler: RoomConstructor, options: any = {}): Promise<RegisteredHandler> {
    return this.matchMaker.registerHandler(name, handler, options);
  }

  public gracefullyShutdown(exit: boolean = true) {
    unregisterNode(this.presence, {
      addressInfo: this.transport.address() as net.AddressInfo,
      processId: this.processId,
    });

    return this.matchMaker.gracefullyShutdown().
      then(() => {
        this.transport.shutdown();
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

}

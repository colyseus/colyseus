import http from 'http';
import net from 'net';
import WebSocket from 'ws';
import { ServerOptions as IServerOptions } from 'ws';

import { debugAndPrintError } from './Debug';
import { MatchMaker } from './MatchMaker';
import { RegisteredHandler } from './matchmaker/RegisteredHandler';
import { Presence } from './presence/Presence';
import { TCPTransport, Transport, WebSocketTransport } from './transport/Transport';

import { RoomConstructor } from './Room';
import { registerGracefulShutdown } from './Utils';

import { generateId } from '.';
import { registerNode, unregisterNode } from './discovery';
import { LocalPresence } from './presence/LocalPresence';

import { Express, Request, Response } from 'express-serve-static-core';
import { MatchMakeError } from './Errors';
import { Protocol } from './Protocol';

export type ServerOptions = IServerOptions & {
  pingTimeout?: number,
  verifyClient?: WebSocket.VerifyClientCallbackAsync
  presence?: any,
  driver?: any,
  engine?: any,
  ws?: any,
  express?: any,
  gracefullyShutdown?: boolean,
};

export class Server {
  public matchMaker: MatchMaker;
  public transport: Transport;

  protected presence: Presence;
  protected processId: string = generateId();
  protected route = '/matchmake';

  constructor(options: ServerOptions = {}) {
    const { gracefullyShutdown = true } = options;

    this.presence = options.presence || new LocalPresence();
    this.matchMaker = new MatchMaker(this.presence, options.driver, this.processId);

    // "presence" option is not used from now on
    delete options.presence;

    this.attach(options);

    if (gracefullyShutdown) {
      registerGracefulShutdown((signal) => this.gracefullyShutdown());
    }

    if (options.express) {
      this.registerExpressRoutes(options.express);
    }
  }

  public attach(options: ServerOptions) {
    if (!options.server) {
      options.server = this.createHttpServer();
    }

    const engine = options.engine || WebSocket.Server;
    delete options.engine;

    this.transport = (engine === net.Server)
      ? new TCPTransport(this.matchMaker, options)
      : new WebSocketTransport(this.matchMaker, options, engine);
  }

  public listen(port: number, hostname?: string, backlog?: number, listeningListener?: Function) {
    this.transport.listen(port, hostname, backlog, () => {
      if (listeningListener) { listeningListener(); }

      this.registerProcessForDiscovery(this.transport);
    });
  }

  public registerProcessForDiscovery(transport: Transport) {
    // register node for proxy/service discovery
    registerNode(this.presence, {
      addressInfo: transport.address() as net.AddressInfo,
      processId: this.processId,
    });
  }

  public define(name: string, handler: RoomConstructor, defaultOptions: any = {}): RegisteredHandler {
    return this.matchMaker.defineRoomType(name, handler, defaultOptions);
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

  protected registerExpressRoutes(app: Express) {
    app.post(`${this.route}/:method/:name`, async (req, res) => {
      const { name, method } = req.params;
      const data = req.body || {};

      try {
        const response = await this.processMatchmakeRequest(method, name, data);
        res.json(response);

      } catch (e) {
        res.json({
          code: e.code || Protocol.ERR_MATCHMAKE_UNHANDLED,
          error: e.message,
        });
      }
    });

    app.get(`${this.route}/:roomName?`, async (req, res) => {
      res.json((
        await this.matchMaker.query(req.params.roomName, { locked: false })
      ));
    });
  }

  protected async processMatchmakeRequest(method: string, name: string, data: any) {
    console.log('processMatchmakeRequest, JSON BODY =>', data);

    if (this.matchMaker.exposedMethods.indexOf(method) === -1) {
      throw new MatchMakeError(`invalid method "${method}"`, Protocol.ERR_MATCHMAKE_UNHANDLED);
    }

    return await this.matchMaker[method](name, data);
  }

  protected createHttpServer() {
    return http.createServer(async (req, res) => {
      if (req.url.indexOf('/matchmake') !== -1) {
        const headers = {
          'Access-Control-Allow-Headers': 'Origin, X-Requested-With, Content-Type, Accept',
          'Access-Control-Allow-Methods': 'OPTIONS, POST, GET',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Max-Age': 2592000,
          // ...
        };

        if (req.method === 'OPTIONS') {
          res.writeHead(204, headers);
          res.end();

        } else if (req.method === 'POST') {
          const matchedParams = req.url.match(/([a-zA-Z_]+)/gi);
          const method = matchedParams[matchedParams.length - 2];
          const name = matchedParams[matchedParams.length - 1];

          const data = [];
          req.on('data', (chunk) => data.push(chunk));
          req.on('end', async () => {
            headers['Content-Type'] = 'application/json';
            res.writeHead(200, headers);

            const body = JSON.parse(Buffer.concat(data).toString());
            try {
              const response = await this.processMatchmakeRequest(method, name, body);
              res.write(JSON.stringify(response));

            } catch (e) {
              res.write(JSON.stringify({
                code: e.code || Protocol.ERR_MATCHMAKE_UNHANDLED,
                error: e.message,
              }));
            }

            res.end();
          });

        } else if (req.method === 'GET') {
          const matchedParams = req.url.match(/([a-zA-Z_]+)/gi);
          let roomName = matchedParams[matchedParams.length - 1];

          // TODO: improve me, "matchmake" room names aren't allowed this way.
          if (roomName === 'matchmake') { roomName = ''; }

          headers['Content-Type'] = 'application/json';
          res.writeHead(200, headers);
          res.write(JSON.stringify(
            await this.matchMaker.query(roomName, { locked: false }),
          ));
          res.end();
        }
      }
    });
  }

}

import http from 'http';
import https from 'https';
import { Http3Server } from '@fails-components/webtransport';
import { URL } from 'url';
import { decode, Iterator } from '@colyseus/schema';

import { matchMaker, Protocol, Transport, debugAndPrintError, spliceOne, getBearerToken } from '@colyseus/core';
import { H3Client } from './H3Client.js';
import { generateWebTransportCertificate } from './utils/mkcert.js';
import type { Application, Request, Response } from 'express';

export type CertLike = string;

export interface TransportOptions {
  app: Application, // express app

  cert?: CertLike,
  key?: CertLike,

  secret?: string,

  server?: http.Server,
  localProxy?: string,
}

export class H3Transport extends Transport {
  public protocol: string = "h3";
  public clients: H3Client[] = [];

  // protected http: http.Server;
  protected https: https.Server;
  protected h3Server: Http3Server;

  private options: TransportOptions;
  private isListening = false;

  private _originalSend: any = null;

  constructor(options: TransportOptions) {
    super();

    this.options = options;

    // local proxy (frontend)
    if (options.localProxy) {
      if (this.options.server) {
        console.warn("H3Transport: 'server' option is ignored when 'localProxy' is set.");
      }

      const uri = new URL(
        (!options.localProxy.startsWith("http"))
          ? `http://${options.localProxy}`
          : options.localProxy
      );

      this.options.server = http.createServer((req, res) => {
        const proxyReq = http.request({
          host: uri.hostname,
          port: uri.port,
          path: req.url,
          method: req.method,
          headers: req.headers,
        }, (proxyRes) => {
          res.writeHead(proxyRes.statusCode!, proxyRes.headers);
          proxyRes.pipe(res, { end: true });
        });
        req.pipe(proxyReq, { end: true });
        proxyReq.on('error', (err) => {
          console.error('Proxy request error:', err);
          res.end();
        });
      });

    }
  }

  public listen(port: number, hostname: string = 'localhost', backlog?: number, listeningListener?: () => void) {
    const createServers = (cert: CertLike, key: CertLike, fingerprint?: number[]) => {
      // this.http = this.options.server || http.createServer(this.options.app);
      // this.http.listen(port);

      this.registerMatchMakeRoutes(fingerprint);

      if (this.options.localProxy) {
        // use http proxy server
        this.options.app.use((req: any, res: any) => {
          this.options.server.emit('request', req, res);
        });
      }

      this.https = https.createServer({ cert, key }, this.options.app);
      this.https.listen(port, hostname, backlog, listeningListener);

      this.h3Server = new Http3Server({
        host: hostname,
        port,
        secret: this.options.secret || "mysecret",
        cert: cert,
        privKey: key,
      });
      this.h3Server.startServer();

      this.isListening = true;
      this.acceptIncomingSessions();
    };

    if (!this.options.cert || !this.options.key) {
      //
      // TODO: cache certificate on filesystem for 10 days
      //
      generateWebTransportCertificate([
        { shortName: 'C', value: 'BR' },
        { shortName: 'ST', value: 'Rio Grande do Sul' },
        { shortName: 'L', value: 'Sapiranga' },
        { shortName: 'O', value: 'Colyseus WebTransport' },
        { shortName: 'CN', value: hostname },
      ], {
        days: 10,
      }).then((generated) => {
        const fingerprint = generated.fingerprint.split(":").map((hex) => parseInt(hex, 16));
        createServers(generated.cert, generated.private, fingerprint);
      });

    } else {
      createServers(this.options.cert, this.options.key);
    }

    return this;
  }

  public shutdown() {
    this.isListening = false;
    // this.http.close();
    this.https.close();
    this.h3Server.stopServer();
  }

  public simulateLatency(milliseconds: number) {
    // if (this._originalSend == null) {
    //   this._originalSend = WebSocket.prototype.send;
    // }

    // const originalSend = this._originalSend;

    // WebSocket.prototype.send = milliseconds <= Number.EPSILON ? originalSend : function (...args: any[]) {
    //   setTimeout(() => originalSend.apply(this, args), milliseconds);
    // };
  }

  protected registerMatchMakeRoutes(fingerprint?: number[]) {
    this.options.app.use((req, res, next) => {
      if (req.method === 'OPTIONS') {
        const headers = Object.assign(
          {},
          matchMaker.controller.DEFAULT_CORS_HEADERS,
          matchMaker.controller.getCorsHeaders.call(undefined, req)
        );
        res.writeHead(204, headers);
        res.end();
      } else {
        next();
      }
    });

    this.options.app.post(`/${matchMaker.controller.matchmakeRoute}/:method/:roomName`, async (req: Request, res: Response) => {
      // do not accept matchmaking requests if already shutting down
      if (matchMaker.state === matchMaker.MatchMakerState.SHUTTING_DOWN) {
        res.writeHead(503, {});
        res.end();
        return;
      }

      const matchedParams = req.url.match(matchMaker.controller.allowedRoomNameChars);
      const matchmakeIndex = matchedParams.indexOf(matchMaker.controller.matchmakeRoute);
      const method = matchedParams[matchmakeIndex + 1];
      const roomName = matchedParams[matchmakeIndex + 2] || '';

      const headers = Object.assign(
        {},
        matchMaker.controller.DEFAULT_CORS_HEADERS,
        matchMaker.controller.getCorsHeaders.call(undefined, req)
      );
      headers['Content-Type'] = 'application/json';
      res.writeHead(200, headers);

      try {
        const clientOptions = req.body;
        const response = await matchMaker.controller.invokeMethod(
          method,
          roomName,
          clientOptions,
          {
            token: (req.query['_authToken'] as string) ?? getBearerToken(req.headers['authorization']),
            headers: req.headers,
            ip: req.headers['x-real-ip'] ?? req.ips
          },
        );

        // specify protocol, if available.
        if (this.protocol !== undefined) {
          response.protocol = this.protocol;
        }

        if (fingerprint) {
          response.fingerprint = fingerprint;
        }

        res.write(JSON.stringify(response));

      } catch (e) {
        res.write(JSON.stringify({ code: e.code, error: e.message, }));
      }

      res.end();
    });
  }

  protected async onConnection(h3Client: H3Client, data: ArrayBufferLike, req?: http.IncomingMessage & any) {
    const it: Iterator = { offset: 0 };

    const roomId = decode.string(data, it);
    const sessionId = decode.string(data, it);
    const reconnectionToken = it.offset < data.byteLength ? decode.string(data, it) : undefined;

    h3Client.sessionId = sessionId;
    h3Client.readyState = 1;

    const room = matchMaker.getLocalRoomById(roomId);

    //
    // TODO: DRY code below with all transports
    //

    try {
      if (!room || !room.hasReservedSeat(sessionId, reconnectionToken)) {
        throw new Error('seat reservation expired.');
      }

      await room._onJoin(h3Client, req);

    } catch (e) {
      debugAndPrintError(e);

      // send error code to client then terminate
      h3Client.error(e.code, e.message, () =>
        h3Client.close(Protocol.WS_CLOSE_WITH_ERROR));
    }
  }

  protected async acceptIncomingSessions() {
    try {
      const sessionStream = await this.h3Server.sessionStream("/");
      const sessionReader = sessionStream.getReader();
      sessionReader.closed.catch((e: any) => console.log("session reader closed with error!", e));

      while (this.isListening) {
        const { done, value } = await sessionReader.read();
        if (done) { break; }

        //
        // TODO: get headers from session reader (?)
        // https://github.com/fails-components/webtransport/issues/279#issuecomment-2036857175
        //

        //  create client instance
        const client = new H3Client(value, (message) => this.onConnection(client, message));
        client.ref.on('open', () => this.clients.push(client));
        client.ref.on("close", () => spliceOne(this.clients, this.clients.indexOf(client)));
      }

    } catch (e) {
      console.error("error:", e);
    }
  }

}

import http from 'http';
import https from 'https';
import { Http3Server } from '@fails-components/webtransport';
import { URL } from 'url';
import { decode, type Iterator } from '@colyseus/schema';

import { matchMaker, Protocol, Transport, createAuthContext, debugAndPrintError, spliceOne, CloseCode, connectClientToRoom, isDevMode } from '@colyseus/core';
import { H3Client } from './H3Client.ts';
import { resolveDevCertificate } from './utils/devCert.ts';
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

  // public server: https.Server;
  protected h3Server: Http3Server;

  private options: TransportOptions;
  private isListening = false;

  private _originalRawSend: typeof H3Client.prototype.raw | null = null;
  private _originalRawUnreliable: typeof H3Client.prototype.rawUnreliable | null = null;

  constructor(options: TransportOptions) {
    super();

    this.options = options;

    // sessions arrive already established, and their headers aren't exposed to us
    if ('beforeUpgrade' in options) {
      console.warn("H3Transport: 'beforeUpgrade' is not supported (WebTransport has no upgrade handshake).");
    }

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

      this.server = https.createServer({ cert, key }, this.options.app);
      this.server.listen(port, hostname, backlog, listeningListener);

      this.h3Server = new Http3Server({
        host: hostname,
        port,
        secret: this.options.secret || "mysecret",
        cert: cert,
        privKey: key,
        defaultDatagramsReadableMode: 'bytes'
      });
      this.h3Server.startServer();

      this.isListening = true;
      this.acceptIncomingSessions();
    };

    if (!this.options.cert || !this.options.key) {
      // Dev: prefer a browser-TRUSTED cert via mkcert (seamless — no flags, no
      // fingerprint), falling back to a self-signed cert pinned by fingerprint.
      resolveDevCertificate(hostname).then(({ cert, key, fingerprint }) => {
        // Surface the fingerprint ONLY for the self-signed fallback, so the core
        // matchmake route hands it to clients for serverCertificateHashes pinning.
        // A trusted (mkcert) cert needs none — the browser validates it normally.
        if (fingerprint) { this.fingerprint = fingerprint; }
        createServers(cert, key, fingerprint);
      });

    } else {
      createServers(this.options.cert, this.options.key);
    }

    return this;
  }

  public shutdown() {
    this.isListening = false;
    // this.http.close();
    this.server.close();
    this.h3Server.stopServer();
  }

  public simulateLatency(milliseconds: number) {
    if (this._originalRawSend == null) {
      this._originalRawSend = H3Client.prototype.raw;
      this._originalRawUnreliable = H3Client.prototype.rawUnreliable;
    }

    const originalRaw = this._originalRawSend;
    const originalRawUnreliable = this._originalRawUnreliable!;
    const delayed = (original: (...args: any[]) => void) => function (this: H3Client, ...args: any[]) {
      let [buf, ...rest] = args;
      buf = Buffer.from(buf); // the encoder may reuse the buffer before the timeout
      setTimeout(() => original.apply(this, [buf, ...rest]), milliseconds);
    };

    // patch the prototype, not instances: `rawUnreliable` presence on it is the
    // datagram capability check
    H3Client.prototype.raw = milliseconds <= Number.EPSILON ? originalRaw : delayed(originalRaw);
    H3Client.prototype.rawUnreliable = milliseconds <= Number.EPSILON ? originalRawUnreliable : delayed(originalRawUnreliable);
  }

  protected registerMatchMakeRoutes(fingerprint?: number[]) {
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


      const requestHeaders = new Headers(req.headers as Record<string, string>);

      const headers = Object.assign(
        {},
        matchMaker.controller.DEFAULT_CORS_HEADERS,
        matchMaker.controller.getCorsHeaders.call(undefined, requestHeaders)
      );
      headers['Content-Type'] = 'application/json';
      res.writeHead(200, headers);

      try {
        const clientOptions = req.body;
        const response = await matchMaker.controller.invokeMethod(
          method,
          roomName,
          clientOptions,
          createAuthContext({
            headers: requestHeaders,
            token: req.query['_authToken'] as string,
            remoteAddress: req.ip,
          }),
        );

        if (fingerprint) {
          response.fingerprint = fingerprint;
        }

        res.write(JSON.stringify(response));

      } catch (e) {
        // @ts-ignore
        res.write(JSON.stringify({ code: e.code, error: e.message, }));
      }

      res.end();
    });
  }

  protected async onConnection(h3Client: H3Client, data: Uint8Array, req?: http.IncomingMessage & any) {
    const it: Iterator = { offset: 0 };

    const roomId = decode.string(data, it);
    const sessionId = decode.string(data, it);

    // If sessionId is not provided, allow ping-pong utility.
    if (!sessionId && !roomId) {
      h3Client.readyState = 1;
      // Disconnect automatically after 1 second if no message is received.
      const timeout = setTimeout(() => h3Client.close(CloseCode.NORMAL_CLOSURE), 1000);
      h3Client.ref.on('message', (_) => h3Client.send(new Uint8Array([Protocol.PING])));
      h3Client.ref.on('close', () => clearTimeout(timeout));
      return;
    }

    const reconnectionToken: string = it.offset < data.byteLength ? decode.string(data, it) : undefined;
    const skipHandshake = (it.offset < data.byteLength && decode.boolean(data, it));

    h3Client.sessionId = sessionId;

    const room = matchMaker.getLocalRoomById(roomId);

    try {
      await connectClientToRoom(room, h3Client, req, { reconnectionToken, skipHandshake });

    } catch (e: any) {
      debugAndPrintError(e);

      // send error code to client then terminate.
      // Use MAY_TRY_RECONNECT in devMode so the SDK retries — the seat
      // may not be reserved yet during HMR reload.
      h3Client.error(e.code, e.message, () =>
        h3Client.close(reconnectionToken
          ? (isDevMode)
            ? CloseCode.MAY_TRY_RECONNECT
            : CloseCode.FAILED_TO_RECONNECT
          : CloseCode.WITH_ERROR));
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

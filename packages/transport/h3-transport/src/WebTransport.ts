import http from 'http';
import https from 'https';
import { Http3Server } from "@fails-components/webtransport";
import { URL } from 'url';

import { matchMaker, Protocol, Transport, debugAndPrintError, debugConnection, registerGracefulShutdown } from '@colyseus/core';
import { WebTransportClient } from './WebTransportClient';
import { generateWebTransportCertificate } from './utils/mkcert';

export type CertLike = string | Buffer;

export interface TransportOptions {
  cert: CertLike,
  key: CertLike,

  secret?: string,

  server?: http.Server,
  app?: any, // express app
}

export class WebTransport extends Transport {
  protected http: http.Server;
  protected https: https.Server;
  protected h3Server: Http3Server;

  private options: TransportOptions;
  private isListening = false;
  private _originalSend: any = null;

  clients: WebTransportClient[] = [];

  constructor(options: TransportOptions) {
    super();

    this.options = options;
  }

  public listen(port: number, hostname: string = 'localhost', backlog?: number, listeningListener?: () => void) {
    const createServers = (cert: CertLike, key: CertLike, fingerprint?: string) => {
      this.http = this.options.server || http.createServer(this.options.app);
      this.http.listen(port + 1000);

      this.https = https.createServer({ cert, key }, this.options.app || function(req, res) {
        //
        // respond to __fingerprint request (development only)
        //
        if (req.url.substring(1) === "__fingerprint") {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify(fingerprint!.split(":").map((hex) => parseInt(hex, 16))));
          return;
        } else {
          res.writeHead(404);
          res.end();
        }
      });
      this.https.listen(port, hostname, backlog, listeningListener);

      this.h3Server = new Http3Server({
        host: hostname,
        port,
        secret: this.options.secret || "mysecret",
        cert: this.options.cert as string,
        privKey: this.options.key as string,
      });
      this.h3Server.startServer();

      this.isListening = true;
      this.loop();
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
        createServers(generated.cert, generated.private);
      });

    } else {
      createServers(this.options.cert, this.options.key);
    }

    return this;
  }

  public shutdown() {
    this.isListening = false;
    this.http.close();
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

  protected async onConnection(rawClient: any, req?: http.IncomingMessage & any) {
    // prevent server crashes if a single client had unexpected error
    rawClient.on('error', (err) => debugAndPrintError(err.message + '\n' + err.stack));

    // compatibility with ws / uws
    const upgradeReq = req || (rawClient as any).upgradeReq;
    const parsedURL = new URL(`ws://server/${upgradeReq.url}`);

    const sessionId = parsedURL.searchParams.get("sessionId");
    const processAndRoomId = parsedURL.pathname.match(/\/[a-zA-Z0-9_\-]+\/([a-zA-Z0-9_\-]+)$/);
    const roomId = processAndRoomId && processAndRoomId[1];

    const room = matchMaker.getRoomById(roomId);

    // set client id
    rawClient.pingCount = 0;

    const client = new WebTransportClient(sessionId, rawClient);

    //
    // TODO: DRY code below with all transports
    //

    try {
      if (!room || !room.hasReservedSeat(sessionId, parsedURL.searchParams.get("reconnectionToken"))) {
        throw new Error('seat reservation expired.');
      }

      await room._onJoin(client, upgradeReq);

    } catch (e) {
      debugAndPrintError(e);

      // send error code to client then terminate
      client.error(e.code, e.message, () =>
        rawClient.close(Protocol.WS_CLOSE_WITH_ERROR));
    }
  }

  protected async loop() {
    try {
      const sessionStream = await this.h3Server.sessionStream("/");
      const sessionReader = sessionStream.getReader();
      sessionReader.closed.catch((e: any) => console.log("session reader closed with error!", e));

      while (this.isListening) {
        console.log("sessionReader.read() - waiting for session...");
        const { done, value } = await sessionReader.read();
        if (done) { break; }

        //
        // TODO: move this to WebTransportClient
        //

        value.closed.then(() => {
          console.log("Session closed successfully!");
        }).catch((e: any) => {
          console.log("Session closed with error! " + e);
        });

        value.ready.then(() => {
          value.createBidirectionalStream().then((bidi) => {
            const reader = bidi.readable.getReader();
            const writer = bidi.writable.getWriter();

            reader.closed.catch((e: any) => console.log("writer closed with error!", e));
            writer.closed.catch((e: any) => console.log("writer closed with error!", e));

          }).catch((e: any) => {
            console.log("failed to create bidirectional stream!", e);
          });

          // reading datagrams
          const datagramReader = value.datagrams.readable.getReader();
          datagramReader.closed.catch((e: any) => console.log("datagram reader closed with error!", e));

          // writing datagrams
          const datagramWriter = value.datagrams.writable.getWriter();
          datagramWriter.closed
            .then(() => console.log("datagram writer closed successfully!"))
            .catch((e: any) => console.log("datagram writer closed with error!", e));
          datagramWriter.write(new Uint8Array([1, 2, 3, 4, 5]));
          datagramWriter.write(new Uint8Array([6, 7, 8, 9, 10]));

        }).catch((e: any) => {
          console.log("session failed to be ready!");
        });
      }

    } catch (e) {
      console.error("error:", e);
    }
  }

}

import * as net from 'net';

import { generateId } from '../..';
import * as matchMaker from '../../MatchMaker';
import { Protocol } from '../../Protocol';
import { ServerOptions } from '../../Server';
import { Transport } from '../Transport';

import { debugAndPrintError, debugError } from '../../Debug';

/**
 * TODO:
 * TCPTransport is not working.
 * It was meant to be used for https://github.com/colyseus/colyseus-gml
 */
export class TCPTransport extends Transport {
  constructor(options: ServerOptions = {}) {
    super();

    this.server = net.createServer();
    this.server.on('connection', this.onConnection);
  }

  public listen(port?: number, hostname?: string, backlog?: number, listeningListener?: () => void): this {
    this.server.listen(port, hostname, backlog, listeningListener);
    return this;
  }

  public shutdown() {
    this.server.close();
  }

  protected onConnection(client: net.Socket & any) {
    // compatibility with ws / uws
    const upgradeReq: any = {};

    // set client id
    client.id = upgradeReq.colyseusid || generateId();
    client.pingCount = 0;

    // set client options
    client.options = upgradeReq.options;
    client.auth = upgradeReq.auth;

    // prevent server crashes if a single client had unexpected error
    client.on('error', (err) => debugError(err.message + '\n' + err.stack));
    // client.on('pong', heartbeat);

    // client.on('data', (data) => this.onMessage(client, decode(data)));
  }

  protected async onMessage(client: net.Socket & any, message: any) {
    console.log('RECEIVED:', message);

    if (message[0] === Protocol.JOIN_ROOM) {
      const roomId = message[1];
      const sessionId = message[2];

      client.id = sessionId;
      client.sessionId = sessionId;

      console.log('EFFECTIVELY CONNECT INTO ROOM', roomId, client.id, client.options);

      client.removeAllListeners('data');

      // forward as 'message' all 'data' messages
      client.on('data', (data) => client.emit('message', data));

      const room = matchMaker.getRoomById(roomId);
      try {
        if (!room || !room.hasReservedSeat(sessionId)) {
          throw new Error('seat reservation expired.');
        }

        await room._onJoin(client);

      } catch (e) {
        debugAndPrintError(e);
        // send[Protocol.ERROR](client, (e && e.message) || '');
        client.close(Protocol.WS_CLOSE_WITH_ERROR);
      }

    }

  }

}

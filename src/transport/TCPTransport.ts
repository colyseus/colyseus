import * as net from "net";

import { isValidId, generateId } from '../';
import { Protocol, send, decode } from "../Protocol";
import { Transport } from './Transport';
import { MatchMaker } from './../MatchMaker';
import { ServerOptions } from './../Server';

import { debugError } from './../Debug';

export class TCPTransport extends Transport {
    constructor (matchMaker: MatchMaker, options: ServerOptions = {}) {
        super(matchMaker);

        this.server = net.createServer();
        this.server.on('connection', this.onConnection);
    }

    public listen(port?: number, hostname?: string, backlog?: number, listeningListener?: Function): this {
        this.server.listen(port, hostname, backlog, listeningListener);
        return this;
    }

    protected onConnection = (client: net.Socket & any) => {
        // compatibility with ws / uws
        const upgradeReq: any = {};

        // set client id
        client.id = upgradeReq.colyseusid || generateId();
        client.pingCount = 0;

        // ensure client has its "colyseusid"
        if (!upgradeReq.colyseusid) {
            send(client, [Protocol.USER_ID, client.id]);
        }

        // set client options
        client.options = upgradeReq.options;
        client.auth = upgradeReq.auth;

        // prevent server crashes if a single client had unexpected error
        client.on('error', (err) => debugError(err.message + '\n' + err.stack));
        // client.on('pong', heartbeat);

        client.on('data', (data) => this.onMessage(client, decode(data)));
    }

    public shutdown () {
        this.server.close();
    }

    protected onMessage (client: net.Socket & any, message: any) {
        console.log("RECEIVED:", message);

        if (
            message[0] === Protocol.JOIN_ROOM &&
            isValidId(message[1]) &&
            isValidId(message[3])
        ) {
            const roomId = message[1];

            client.id = message[3];
            client.options = message[2];

            console.log("EFFECTIVELY CONNECT INTO ROOM", roomId, client.id, client.options);

            client.removeAllListeners('data');

            // forward as 'message' all 'data' messages
            client.on('data', (data) => client.emit('message', data));

            this.matchMaker.connectToRoom(client, roomId).
                catch((e) => {
                    debugError(e.stack || e);
                    send(client, [Protocol.JOIN_ERROR, roomId, e && e.message]);
                });

        } else {
            this.onMessageMatchMaking(client, message);
        }

    }

}
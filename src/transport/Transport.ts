import * as net from "net";
import * as http from "http";
import * as https from "https";

import { Client, isValidId } from '..';
import { Protocol, decode, send } from "../Protocol";
import { MatchMaker } from '../MatchMaker';
import { MatchMakeError } from './../Errors';

import { debugError, debugAndPrintError } from './../Debug';
import { retry } from "../Utils";

export abstract class Transport {
    public server: net.Server | http.Server | https.Server;
    protected matchMaker: MatchMaker;

    constructor (matchMaker: MatchMaker) {
        this.matchMaker = matchMaker;
    }

    public address () {
        return this.server.address();
    }

    abstract listen(port?: number, hostname?: string, backlog?: number, listeningListener?: Function): this;
    abstract shutdown(): void;

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
                    then((response: { roomId: string, processId: string }) => {
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

export { TCPTransport } from "./TCPTransport";
export { WebSocketTransport } from "./WebSocketTransport";
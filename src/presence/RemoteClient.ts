import * as WebSocket from 'ws';

import { EventEmitter } from 'events';
import { Client } from './../index';
import { Presence } from './Presence';

export class RemoteClient extends EventEmitter {
    public id: string;
    public sessionId: string;

    protected readyState = WebSocket.OPEN;

    protected roomId: string;
    protected presence: Presence;

    constructor(client: Client, roomId: string, presence: Presence) {
        super();

        this.id = client.id;
        this.sessionId = client.sessionId;
        this.roomId = roomId;

        this.presence = presence;
    }

    public send(buffer: Buffer) {
        this.presence.publish(`${this.roomId}:${this.sessionId}`, ['send', Array.from(buffer)]);
    }

    public close(code?: number) {
        this.presence.publish(`${this.roomId}:${this.sessionId}`, ['close', code]);
    }
}

import { EventEmitter } from 'events';
import { Client } from './../index';
import { Presence } from './Presence';

export class RemoteClient extends EventEmitter {
    public id: string;
    public sessionId: string;

    send (data: any) {
    }

    close () {
    }
}
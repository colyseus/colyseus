import { Presence } from './Presence';
import { spliceOne } from '../Utils';

export class LocalPresence implements Presence {
    data: {[roomName: string]: string[]} = {};

    subscribe(topic: string, callback: Function) {
        return this;
    }

    unsubscribe (topic: string) {
        return this;
    }

    publish(topic: string, data: any) {
        return this;
    }

    sadd (key: string, value: any) {
        if (!this.data[key]) this.data[key] = [];

        if (this.data[key].indexOf(value) === -1) {
            this.data[key].push(value);
        }
    }

    async smembers (key: string): Promise<string[]> {
        return this.data[key] || [];
    }

    srem (key: string, value: any) {
        if (this.data[key]) {
            spliceOne(this.data[key], this.data[key].indexOf(value));
        }
    }

}
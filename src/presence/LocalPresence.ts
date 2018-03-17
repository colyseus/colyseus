import { Presence } from './Presence';
import { spliceOne } from '../Utils';

export class LocalPresence implements Presence {
    // "channels"
    rooms: {[roomId: string]: boolean} = {};

    data: {[roomName: string]: string[]} = {};
    hash: {[roomName: string]: {[key: string]: string}} = {};

    subscribe(topic: string, callback: Function) {
        this.rooms[topic] = true;
        return this;
    }

    unsubscribe (topic: string) {
        this.rooms[topic] = false;
        return this;
    }

    publish(topic: string, data: any) {
        return this;
    }

    async exists (roomId: string): Promise<boolean> {
        return this.rooms[roomId];
    }

    del (key: string) {
        delete this.data[key];
        delete this.hash[key];
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

    hset (roomId: string, key: string, value: string) {
        if (!this.hash[roomId]) {
            this.hash[roomId] = {};
        }

        this.hash[roomId][key] = value;
    }

    async hget (roomId: string, key: string) {
        return this.hash[roomId] && this.hash[roomId][key];
    }

    hdel (roomId: string, key: any) {
        delete this.hash[roomId][key];
    }

    async hlen (roomId: string) {
        return Object.keys(this.hash[roomId]).length;
    }

}
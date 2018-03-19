import { spliceOne } from '../Utils';
import { Presence } from './Presence';

export class LocalPresence implements Presence {
    // "channels"
    public rooms: {[roomId: string]: boolean} = {};

    public data: {[roomName: string]: string[]} = {};
    public hash: {[roomName: string]: {[key: string]: string}} = {};

    public subscribe(topic: string, callback: Function) {
        this.rooms[topic] = true;
        return this;
    }

    public unsubscribe(topic: string) {
        this.rooms[topic] = false;
        return this;
    }

    public publish(topic: string, data: any) {
        return this;
    }

    public async exists(roomId: string): Promise<boolean> {
        return this.rooms[roomId];
    }

    public del(key: string) {
        delete this.data[key];
        delete this.hash[key];
    }

    public sadd(key: string, value: any) {
        if (!this.data[key]) { this.data[key] = []; }

        if (this.data[key].indexOf(value) === -1) {
            this.data[key].push(value);
        }
    }

    public async smembers(key: string): Promise<string[]> {
        return this.data[key] || [];
    }

    public srem(key: string, value: any) {
        if (this.data[key]) {
            spliceOne(this.data[key], this.data[key].indexOf(value));
        }
    }

    public hset(roomId: string, key: string, value: string) {
        if (!this.hash[roomId]) {
            this.hash[roomId] = {};
        }

        this.hash[roomId][key] = value;
    }

    public async hget(roomId: string, key: string) {
        return this.hash[roomId] && this.hash[roomId][key];
    }

    public hdel(roomId: string, key: any) {
        delete this.hash[roomId][key];
    }

    public async hlen(roomId: string) {
        return Object.keys(this.hash[roomId]).length;
    }

}

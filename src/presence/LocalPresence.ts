import { spliceOne } from '../Utils';
import { Presence } from './Presence';

export class LocalPresence implements Presence {
    public channels: {[roomId: string]: boolean} = {};

    public data: {[roomName: string]: string[]} = {};
    public hash: {[roomName: string]: {[key: string]: string}} = {};

    public keys: {[name: string]: string} = {};
    private timeouts: {[name: string]: NodeJS.Timer} = {};

    public subscribe(topic: string, callback: Function) {
        this.channels[topic] = true;
        return this;
    }

    public unsubscribe(topic: string) {
        this.channels[topic] = false;
        return this;
    }

    public publish(topic: string, data: any) {
        return this;
    }

    public async exists(roomId: string): Promise<boolean> {
        return this.channels[roomId];
    }

    public setex(key: string, value: string, seconds: number) {
        // ensure previous timeout is clear before setting another one.
        if (this.timeouts[key]) {
            clearTimeout(this.timeouts[key]);
        }

        this.keys[key] = value;
        this.timeouts[key] = setTimeout(() => {
            delete this.keys[key];
            delete this.timeouts[key];
        }, seconds * 1000);
    }

    public get(key: string) {
        return this.keys[key];
    }

    public del(key: string) {
        delete this.data[key];
        delete this.hash[key];
    }

    public sadd(key: string, value: any) {
        if (!this.data[key]) {
            this.data[key] = [];
        }

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

    public scard(key: string) {
        return this.data[key].length;
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
        if (this.hash[roomId]) {
            delete this.hash[roomId][key];
        }
    }

    public async hlen(roomId: string) {
        return this.hash[roomId] && Object.keys(this.hash[roomId]).length || 0;
    }

}

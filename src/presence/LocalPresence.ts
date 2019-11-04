import { EventEmitter } from 'events';
import { spliceOne } from '../Utils';
import { Presence } from './Presence';

export class LocalPresence implements Presence {
    public channels = new EventEmitter();

    public data: {[roomName: string]: string[]} = {};
    public hash: {[roomName: string]: {[key: string]: string}} = {};

    public keys: {[name: string]: string | number} = {};
    private listenersByTopic: {[id: string]: Array<(...args: any[]) => void>} = {};
    private timeouts: {[name: string]: NodeJS.Timer} = {};

    public subscribe(topic: string, callback: (...args: any[]) => void) {
        if (!this.listenersByTopic[topic]) { this.listenersByTopic[topic] = []; }
        this.listenersByTopic[topic].push(callback);
        this.channels.on(topic, callback);
        return this;
    }

    public unsubscribe(topic: string) {
        if (this.listenersByTopic[topic]) {
          this.listenersByTopic[topic].forEach((callback) => this.channels.removeListener(topic, callback));
          delete this.listenersByTopic[topic];
        }
        return this;
    }

    public publish(topic: string, data: any) {
        this.channels.emit(topic, data);
        return this;
    }

    public async exists(roomId: string): Promise<boolean> {
        return this.channels.listenerCount(roomId) > 0;
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
        delete this.keys[key];
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
        return (this.data[key] || []).length;
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

    public async incr(key: string) {
        if (!this.keys[key]) {
            this.keys[key] = 0;
        }
        (this.keys[key] as number)++;
        return this.keys[key];
    }

    public async decr(key: string) {
        if (!this.keys[key]) {
            this.keys[key] = 0;
        }
        (this.keys[key] as number)--;
        return this.keys[key];
    }

}

import * as memshared from 'memshared';
import { promisify } from 'util';

import { Presence } from './Presence';

export class MemsharedPresence implements Presence {
    protected subscriptions: {[channel: string]: (...args: any[]) => any} = {};

    public subscribe(topic: string, callback: Function) {
        this.subscriptions[topic] = (channel, message) => {
            if (channel === topic) {
                callback(JSON.parse(message));
            }
        };

        memshared.subscribe(topic, this.subscriptions[topic]);
    }

    public unsubscribe(topic: string) {
        memshared.unsubscribe(topic, this.subscriptions[topic]);
        delete this.subscriptions[topic];
    }

    public publish(topic: string, data: any) {
        memshared.publish(topic, data);
    }

    public async exists(roomId: string): Promise<boolean> {
    }

    public del(roomId: string) {
        memshared.del(roomId);
    }

    public sadd(key: string, value: any) {
        memshared.sadd(key, value);
    }

    public smembers(key: string): Promise<string[]> {
        return new Promise((resolve, reject) => {
            memshared.smembers(key, (err, data) => {
                if (err) return reject(err)
                resolve(data);
            })
        });
    }

    public srem(key: string, value: any) {
        memshared.srem(key, value);
    }

    public hset(roomId: string, key: string, value: string) {
        memshared.hset(roomId, key, value);
    }

    public hget(roomId: string, key: string): Promise<any> {
        return new Promise((resolve, reject) => {
            memshared.hget(roomId, key, (err, data) => {
                if (err) return reject(err)
                resolve(data);
            })
        });
    }

    public hdel(roomId: string, key: string) {
        memshared.hdel(roomId, key);
    }

    public hlen(roomId: string): Promise<number> {
        return new Promise((resolve, reject) => {
            memshared.hlen(roomId, (err, data) => {
                if (err) return reject(err)
                resolve(data);
            })
        });
    }

}

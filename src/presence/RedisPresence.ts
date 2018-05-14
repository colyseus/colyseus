import * as redis from 'redis';
import { promisify } from 'util';

import { Presence } from './Presence';

export class RedisPresence implements Presence {
    public sub: redis.RedisClient;
    public pub: redis.RedisClient;

    protected subscriptions: {[channel: string]: (...args: any[]) => any} = {};

    protected smembersAsync: any;
    protected hgetAsync: any;
    protected hlenAsync: any;
    protected pubsubAsync: any;

    constructor(opts?: redis.ClientOpts) {
        this.sub = redis.createClient(opts);
        this.pub = redis.createClient(opts);

        // create promisified redis methods.
        this.smembersAsync = promisify(this.pub.smembers).bind(this.pub);
        this.hgetAsync = promisify(this.pub.hget).bind(this.pub);
        this.hlenAsync = promisify(this.pub.hlen).bind(this.pub);
        this.pubsubAsync = promisify(this.pub.pubsub).bind(this.pub);
    }

    public subscribe(topic: string, callback: Function) {
        this.sub.subscribe(topic);

        this.subscriptions[topic] = (channel, message) => {
            if (channel === topic) {
                callback(JSON.parse(message));
            }
        };

        this.sub.addListener('message', this.subscriptions[topic]);

        return this;
    }

    public unsubscribe(topic: string) {
        this.sub.removeListener('message', this.subscriptions[topic]);

        this.sub.unsubscribe(topic);

        delete this.subscriptions[topic];

        return this;
    }

    public publish(topic: string, data: any) {
        if (data === undefined) {
            data = false;
        }

        this.pub.publish(topic, JSON.stringify(data));
    }

    public async exists(roomId: string): Promise<boolean> {
        return (await this.pubsubAsync('channels', roomId)).length > 0;
    }

    public setex(key: string, value: string, seconds: number) {
        this.pub.setex(key, seconds, value);
    }

    public async get(key: string) {
        return new Promise((resolve, reject) => {
            this.pub.get(key, (err, data) => {
                if (err) { return reject(err); }
                resolve(data);
            });
        });
    }

    public del(roomId: string) {
        this.pub.del(roomId);
    }

    public sadd(key: string, value: any) {
        this.pub.sadd(key, value);
    }

    public smembers(key: string): Promise<string[]> {
        return this.smembersAsync(key);
    }

    public srem(key: string, value: any) {
        this.pub.srem(key, value);
    }

    public scard(key: string) {
        return new Promise((resolve, reject) => {
            this.pub.scard(key, (err, data) => {
                if (err) { return reject(err); }
                resolve(data);
            });
        });
    }

    public hset(roomId: string, key: string, value: string) {
        this.pub.hset(roomId, key, value);
    }

    public hget(roomId: string, key: string) {
        return this.hgetAsync(roomId, key);
    }

    public hdel(roomId: string, key: string) {
        this.pub.hdel(roomId, key);
    }

    public hlen(roomId: string): Promise<number> {
        return this.hlenAsync(roomId);
    }

}

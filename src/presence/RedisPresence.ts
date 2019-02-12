import * as redis from 'redis';
import { promisify } from 'util';

import { Presence } from './Presence';

export class RedisPresence implements Presence {
    public sub: redis.RedisClient;
    public pub: redis.RedisClient;

    protected subscribeAsync: any;
    protected unsubscribeAsync: any;
    protected publishAsync: any;

    protected subscriptions: {[channel: string]: (...args: any[]) => any} = {};

    protected smembersAsync: any;
    protected hgetAsync: any;
    protected hlenAsync: any;
    protected pubsubAsync: any;
    protected incrAsync: any;
    protected decrAsync: any;

    constructor(opts?: redis.ClientOpts) {
        this.sub = redis.createClient(opts);
        this.pub = redis.createClient(opts);

        // no listener limit
        this.sub.setMaxListeners(0);

        // create promisified pub/sub methods.
        this.subscribeAsync = promisify(this.sub.subscribe).bind(this.sub);
        this.unsubscribeAsync = promisify(this.sub.unsubscribe).bind(this.sub);

        this.publishAsync = promisify(this.pub.publish).bind(this.pub);

        // create promisified redis methods.
        this.smembersAsync = promisify(this.pub.smembers).bind(this.pub);
        this.hgetAsync = promisify(this.pub.hget).bind(this.pub);
        this.hlenAsync = promisify(this.pub.hlen).bind(this.pub);
        this.pubsubAsync = promisify(this.pub.pubsub).bind(this.pub);
        this.incrAsync = promisify(this.pub.incr).bind(this.pub);
        this.decrAsync = promisify(this.pub.decr).bind(this.pub);
    }

    public async subscribe(topic: string, callback: Function) {
        this.subscriptions[topic] = (channel, message) => {
            if (channel === topic) {
                callback(JSON.parse(message));
            }
        };

        this.sub.addListener('message', this.subscriptions[topic]);

        await this.subscribeAsync(topic);

        return this;
    }

    public async unsubscribe(topic: string) {
        this.sub.removeListener('message', this.subscriptions[topic]);

        delete this.subscriptions[topic];

        await this.unsubscribeAsync(topic);

        return this;
    }

    public async publish(topic: string, data: any) {
        if (data === undefined) {
            data = false;
        }

        await this.publishAsync(topic, JSON.stringify(data));
    }

    public async exists(roomId: string): Promise<boolean> {
        return (await this.pubsubAsync('channels', roomId)).length > 0;
    }

    public async setex(key: string, value: string, seconds: number) {
      return new Promise((resolve) =>
        this.pub.setex(key, seconds, value, resolve));
    }

    public async get(key: string) {
        return new Promise((resolve, reject) => {
            this.pub.get(key, (err, data) => {
                if (err) { return reject(err); }
                resolve(data);
            });
        });
    }

    public async del(roomId: string) {
        return new Promise((resolve) => {
            this.pub.del(roomId, resolve);
        });
    }

    public async sadd(key: string, value: any) {
        return new Promise((resolve) => {
            this.pub.sadd(key, value, resolve);
        });
    }

    public async smembers(key: string): Promise<string[]> {
        return await this.smembersAsync(key);
    }

    public async srem(key: string, value: any) {
        return new Promise((resolve) => {
            this.pub.srem(key, value, resolve);
        });
    }

    public async scard(key: string) {
        return new Promise((resolve, reject) => {
            this.pub.scard(key, (err, data) => {
                if (err) { return reject(err); }
                resolve(data);
            });
        });
    }

    public async hset(roomId: string, key: string, value: string) {
        return new Promise((resolve) => {
            this.pub.hset(roomId, key, value, resolve);
        });
    }

    public async hget(roomId: string, key: string) {
        return await this.hgetAsync(roomId, key);
    }

    public async hdel(roomId: string, key: string) {
        return new Promise((resolve) => {
            this.pub.hdel(roomId, key, resolve);
        });
    }

    public async hlen(roomId: string): Promise<number> {
        return await this.hlenAsync(roomId);
    }

    public async incr(key: string): Promise<number> {
        return await this.incrAsync(key);
    }

    public async decr(key: string): Promise<number> {
        return await this.decrAsync(key);
    }

}

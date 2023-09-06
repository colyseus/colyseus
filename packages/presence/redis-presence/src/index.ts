import Redis from 'ioredis';
import { Presence } from '@colyseus/core';

type Callback = (...args: any[]) => void;

export class RedisPresence implements Presence {
    public sub: Redis.Redis;
    public pub: Redis.Redis;

    protected subscriptions: { [channel: string]: Callback[] } = {};

    constructor(opts?: Redis.RedisOptions) {
        this.sub = new Redis(opts);
        this.pub = new Redis(opts);

        // no listener limit
        this.sub.setMaxListeners(0);
    }

    public async subscribe(topic: string, callback: Callback) {
        if (!this.subscriptions[topic]) {
          this.subscriptions[topic] = [];
        }

        this.subscriptions[topic].push(callback);

        if (this.sub.listeners('message').length === 0) {
          this.sub.on('message', this.handleSubscription);
        }

        await this.sub.subscribe(topic);

        return this;
    }

    public async unsubscribe(topic: string, callback?: Callback) {
        const topicCallbacks = this.subscriptions[topic];
        if (!topicCallbacks) { return; }

        if (callback) {
          const index = topicCallbacks.indexOf(callback);
          topicCallbacks.splice(index, 1);

        } else {
          this.subscriptions[topic] = [];
        }

        if (this.subscriptions[topic].length === 0) {
          delete this.subscriptions[topic];
          await this.sub.unsubscribe(topic);
        }

        return this;
    }

    public async publish(topic: string, data: any) {
        if (data === undefined) {
            data = false;
        }

        await this.pub.publish(topic, JSON.stringify(data));

        return this;
    }

    public async exists(roomId: string) {
        return (await (this.pub as any).pubsub('channels', roomId)).length > 0;
    }

    public async setex(key: string, value: string, seconds: number) {
        return await this.pub.setex(key, seconds, value);
    }

    public async get(key: string) {
        return await this.pub.get('key');
    }

    public async del(key: string) {
        return await this.pub.del(key);
    }

    public async sadd(key: string, value: any) {
        return await this.pub.sadd(key, value);
    }

    public async smembers(key: string) {
        return await this.pub.smembers(key);
    }

    public async sismember(key: string, field: string) {
        return await this.pub.sismember(key, field);
    }

    public async srem(key: string, value: any) {
        return await this.pub.srem(key, value);
    }

    public async scard(key: string) {
        return await this.pub.scard(key);
    }

    public async sinter(...keys: string[]) {
        return await this.pub.sinter(...keys);
    }

    public async hset(key: string, field: string, value: string) {
        return await this.pub.hset(key, field, value);
    }

    public async hincrby(key: string, field: string, value: number) {
        return new Promise<number>((resolve, reject) => {
          this.pub.hincrby(key, field, value, (err, result) => {
            if (err) return reject(err);
            resolve(result);
          });
        });
    }

    public async hget(key: string, field: string) {
        return await this.pub.hget(key, field);
    }

    public async hgetall(key: string) {
        return await this.pub.hgetall(key);
    }

    public async hdel(key: string, field: string) {
        return await this.pub.hdel(key, field);
    }

    public async hlen(key: string): Promise<number> {
        return await this.pub.hlen(key);
    }

    public async incr(key: string): Promise<number> {
        return await this.pub.incr(key);
    }

    public async decr(key: string): Promise<number> {
        return await this.pub.decr(key);
    }

    public async shutdown() {
        await this.sub.quit();
        await this.pub.quit();
    }

    protected handleSubscription = (channel, message) => {
        if (this.subscriptions[channel]) {
          for (let i = 0, l = this.subscriptions[channel].length; i < l; i++) {
            this.subscriptions[channel][i](JSON.parse(message));
          }
        }
    }
}

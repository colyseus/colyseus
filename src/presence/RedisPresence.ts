import redis from 'redis';
import { promisify } from 'util';

import { Presence } from './Presence';

type Callback = (...args: any[]) => void;

export class RedisPresence implements Presence {
    public sub: redis.RedisClient;
    public pub: redis.RedisClient;

    protected subscribeAsync: any;
    protected unsubscribeAsync: any;
    protected publishAsync: any;

    protected subscriptions: { [channel: string]: Callback[] } = {};

    protected smembersAsync: any;
    protected sismemberAsync: any;
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
        this.sismemberAsync = promisify(this.pub.sismember).bind(this.pub);
        this.hgetAsync = promisify(this.pub.hget).bind(this.pub);
        this.hlenAsync = promisify(this.pub.hlen).bind(this.pub);
        this.pubsubAsync = promisify(this.pub.pubsub).bind(this.pub);
        this.incrAsync = promisify(this.pub.incr).bind(this.pub);
        this.decrAsync = promisify(this.pub.decr).bind(this.pub);
    }

    public async subscribe(topic: string, callback: Callback) {
        if (!this.subscriptions[topic]) {
          this.subscriptions[topic] = [];
        }

        this.subscriptions[topic].push(callback);

        if (this.sub.listeners('message').length === 0) {
          this.sub.addListener('message', this.handleSubscription);
        }

        await this.subscribeAsync(topic);

        return this;
    }

    public async unsubscribe(topic: string, callback?: Callback) {
        if (callback) {
          const index = this.subscriptions[topic].indexOf(callback);
          this.subscriptions[topic].splice(index, 1);

        } else {
          this.subscriptions[topic] = [];
        }

        if (this.subscriptions[topic].length === 0) {
          await this.unsubscribeAsync(topic);
        }

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

    public async sismember(key: string, field: string): Promise<number> {
        return await this.sismemberAsync(key, field);
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

    public async sinter(...keys: string[]) {
        return new Promise<string[]>((resolve, reject) => {
            this.pub.sinter(...keys, (err, data) => {
                if (err) { return reject(err); }
                resolve(data);
            });
        });
    }

    public async hset(key: string, field: string, value: string) {
        return new Promise((resolve) => {
            this.pub.hset(key, field, value, resolve);
        });
    }

    public async hincrby(key: string, field: string, value: number) {
        return new Promise((resolve) => {
            this.pub.hincrby(key, field, value, resolve);
        });
    }

    public async hget(key: string, field: string) {
        return await this.hgetAsync(key, field);
    }

    public async hgetall(key: string) {
        return new Promise<{ [key: string]: string }>((resolve, reject) => {
            this.pub.hgetall(key, (err, values) => {
              if (err) { return reject(err); }
              resolve(values);
            });
        });
    }

    public async hdel(key: string, field: string) {
        return new Promise((resolve, reject) => {
            this.pub.hdel(key, field, (err, ok) => {
              if (err) { return reject(err); }
              resolve(ok);
            });
        });
    }

    public async hlen(key: string): Promise<number> {
        return await this.hlenAsync(key);
    }

    public async incr(key: string): Promise<number> {
        return await this.incrAsync(key);
    }

    public async decr(key: string): Promise<number> {
        return await this.decrAsync(key);
    }

    protected handleSubscription = (channel, message) => {
        if (this.subscriptions[channel]) {
          for (let i = 0, l = this.subscriptions[channel].length; i < l; i++) {
            this.subscriptions[channel][i](JSON.parse(message));
          }
        }
    }

}

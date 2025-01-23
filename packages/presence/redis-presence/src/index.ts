import Redis, { Cluster, ClusterNode, ClusterOptions, RedisOptions } from 'ioredis';
import { Presence, spliceOne } from '@colyseus/core';

type Callback = (...args: any[]) => void;

export class RedisPresence implements Presence {
    protected sub: Redis | Cluster;
    protected pub: Redis | Cluster;

    protected subscriptions: { [channel: string]: Callback[] } = {};

    constructor(options?: number | string | RedisOptions | ClusterNode[], clusterOptions?: ClusterOptions) {
        if (Array.isArray(options)) {
            this.sub = new Cluster(options, clusterOptions)
            this.pub = new Cluster(options, clusterOptions);

        } else {
            this.sub = new Redis(options as RedisOptions);
            this.pub = new Redis(options as RedisOptions);
        }

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
          spliceOne(topicCallbacks, index);

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
    }

    public async exists(roomId: string): Promise<boolean> {
        return (await (this.pub as any).pubsub("channels", roomId)).length > 0;
    }

    public async set(key: string, value: string) {
      return new Promise((resolve) =>
        this.pub.set(key, value, resolve));
    }

    public async setex(key: string, value: string, seconds: number) {
      return new Promise((resolve) =>
        this.pub.setex(key, seconds, value, resolve));
    }

    public async expire(key: string, seconds: number) {
      return new Promise((resolve) =>
        this.pub.expire(key, seconds, resolve));
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
        return await this.pub.smembers(key);
    }

    public async sismember(key: string, field: string): Promise<number> {
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

    public async hincrbyex(key: string, field: string, value: number, expireInSeconds: number) {
        return new Promise<number>((resolve, reject) => {
          this.pub.multi()
            .hincrby(key, field, value)
            .expire(key, expireInSeconds)
            .exec((err, results) => {
              if (err) return reject(err);
              resolve(results[0][1] as number);
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
        return (await this.pub.hdel(key, field)) > 0;
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

    public async llen(key: string): Promise<number> {
      return await this.pub.llen(key);
    }

    public async rpush(key: string, value: string): Promise<number> {
      return await this.pub.rpush(key, value);
    }

    public async lpush(key: string, value: string): Promise<number> {
      return await this.pub.lpush(key, value);
    }

    public async rpop(key: string): Promise<string> {
      return await this.pub.rpop(key);
    }

    public async lpop(key: string): Promise<string> {
      return await this.pub.lpop(key);
    }

    public async brpop(...args: [...keys: string[], timeoutInSeconds: number]): Promise<[string, string] | null> {
      return await this.pub.brpop.apply(this.pub, args);
    }

    public shutdown() {
        this.sub.quit();
        this.pub.quit();
    }

    protected handleSubscription = (channel, message) => {
        if (this.subscriptions[channel]) {
          for (let i = 0, l = this.subscriptions[channel].length; i < l; i++) {
            this.subscriptions[channel][i](JSON.parse(message));
          }
        }
    }

}

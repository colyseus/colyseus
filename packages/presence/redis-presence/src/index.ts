import { Redis, Cluster, type ClusterNode, type ClusterOptions, type RedisOptions } from 'ioredis';
import { logger, type Presence } from '@colyseus/core';
import EventEmitter from 'events';

type Callback = (...args: any[]) => void;

export class RedisPresence implements Presence {
    protected sub: Redis | Cluster;
    protected pub: Redis | Cluster;

    protected subscriptions = new EventEmitter();

    constructor(options?: number | string | RedisOptions | ClusterNode[] | Redis | Cluster, clusterOptions?: ClusterOptions) {
        //
        // The ready check issues INFO, which Redis rejects on a subscriber-mode connection.
        // ioredis then skips readyHandler() — the only place autoResubscribe runs — leaving
        // the socket connected but permanently unsubscribed, and invisible to matchmaking.
        //
        const subOptions: Partial<RedisOptions> = { enableReadyCheck: false };

        if (options instanceof Cluster) {
            this.pub = options;
            this.sub = options.duplicate([], { redisOptions: { ...options.options?.redisOptions, ...subOptions } });
        } else if (options instanceof Redis) {
            this.pub = options;
            this.sub = options.duplicate(subOptions);
        } else if (Array.isArray(options)) {
            this.pub = new Cluster(options, clusterOptions);
            this.sub = new Cluster(options, { ...clusterOptions, redisOptions: { ...clusterOptions?.redisOptions, ...subOptions } });
        } else if (typeof options === 'number' || typeof options === 'string') {
            this.pub = new Redis(options as any);
            this.sub = new Redis(options as any, subOptions);
        } else {
            this.pub = new Redis(options as RedisOptions);
            this.sub = new Redis({ ...options, ...subOptions });
        }

        // no listener limit
        this.sub.setMaxListeners(0);

        // ioredis logs an "Unhandled error event" without these, so connection
        // failures stay invisible until matchmaking silently breaks.
        this.sub.on('error', (e) => logger.warn('RedisPresence: sub connection error:', e.message));
        this.pub.on('error', (e) => logger.warn('RedisPresence: pub connection error:', e.message));

        // ioredis only restores subscriptions it saw succeed, and never retries a
        // SUBSCRIBE rejected mid-reconnect — either way the topic is silently dead
        // forever. `subscriptions` holds the intended set, so reconcile from it.
        this.sub.on('ready', () => this.resubscribeAll());
    }

    /**
     * Re-issue SUBSCRIBE for every topic we intend to be listening on.
     * SUBSCRIBE is idempotent, so overlapping with ioredis' own autoResubscribe is harmless.
     */
    protected resubscribeAll() {
        const topics = this.subscriptions.eventNames().filter((topic): topic is string => typeof topic === 'string');
        if (topics.length === 0) { return; }

        (this.sub as Redis).subscribe(...topics).catch((e) =>
          logger.warn('RedisPresence: failed to re-subscribe:', e.message));
    }

    public async subscribe(topic: string, callback: Callback) {
        this.subscriptions.addListener(topic, callback);

        if (this.sub.listeners('message').length === 0) {
          this.sub.on('message', this.handleSubscription);
        }

        await this.sub.subscribe(topic);

        return this;
    }

    public async unsubscribe(topic: string, callback?: Callback) {
        if (callback) {
          this.subscriptions.removeListener(topic, callback);

        } else {
          this.subscriptions.removeAllListeners(topic);
        }

        if (this.subscriptions.listenerCount(topic) === 0) {
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

    public channels(pattern: string = '*') {
      return this.pub.pubsub("CHANNELS", pattern) as Promise<string[]>;
    }

    public async exists(key: string): Promise<boolean> {
        return (await this.pub.exists(key)) === 1;
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
        return (await this.pub.hset(key, field, value)) > 0;
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

    public async rpush(key: string, ...values: string[]): Promise<number> {
      return await this.pub.rpush(key, ...values);
    }

    public async lpush(key: string, ...values: string[]): Promise<number> {
      return await this.pub.lpush(key, ...values);
    }

    public async rpop(key: string): Promise<string | null> {
      return await this.pub.rpop(key);
    }

    public async lpop(key: string): Promise<string | null> {
      return await this.pub.lpop(key);
    }

    /**
     * Blocking pop, on a connection of its own: ioredis queues every command
     * behind a blocking one, so running this on `pub` would stall the whole
     * instance — matchmaking included — until an item lands or the timeout
     * expires. A dedicated connection also keeps concurrent `brpop()` calls
     * from serializing behind each other.
     */
    public async brpop(...args: any): Promise<[string, string] | null> {
      const blocking = (this.pub instanceof Cluster)
        ? this.pub.duplicate([])
        : this.pub.duplicate();
      try {
        return await blocking.brpop.apply(blocking, args);
      } finally {
        blocking.quit().catch(() => { /* already gone */ });
      }
    }

    public shutdown() {
        this.sub.quit();
        this.pub.quit();
    }

    public setMaxListeners(number: number) {
      this.subscriptions.setMaxListeners(number);
    }

    protected handleSubscription = (channel, message) => {
        this.subscriptions.emit(channel, JSON.parse(message));
    }

}

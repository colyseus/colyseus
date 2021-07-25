import redis from 'redis';
import { Presence } from '@colyseus/core';
declare type Callback = (...args: any[]) => void;
export declare class RedisPresence implements Presence {
    sub: redis.RedisClient;
    pub: redis.RedisClient;
    protected subscriptions: {
        [channel: string]: Callback[];
    };
    protected subscribeAsync: any;
    protected unsubscribeAsync: any;
    protected publishAsync: any;
    protected smembersAsync: any;
    protected sismemberAsync: any;
    protected hgetAsync: any;
    protected hlenAsync: any;
    protected pubsubAsync: any;
    protected incrAsync: any;
    protected decrAsync: any;
    private prefix;
    constructor(opts?: redis.ClientOpts, prefix?: string);
    subscribe(topic: string, callback: Callback): Promise<this>;
    unsubscribe(topic: string, callback?: Callback): Promise<this>;
    publish(topic: string, data: any): Promise<void>;
    exists(roomId: string): Promise<boolean>;
    setex(key: string, value: string, seconds: number): Promise<unknown>;
    get(key: string): Promise<unknown>;
    del(roomId: string): Promise<unknown>;
    sadd(key: string, value: any): Promise<unknown>;
    smembers(key: string): Promise<string[]>;
    sismember(key: string, field: string): Promise<number>;
    srem(key: string, value: any): Promise<unknown>;
    scard(key: string): Promise<unknown>;
    sinter(...keys: string[]): Promise<string[]>;
    hset(key: string, field: string, value: string): Promise<unknown>;
    hincrby(key: string, field: string, value: number): Promise<unknown>;
    hget(key: string, field: string): Promise<any>;
    hgetall(key: string): Promise<{
        [key: string]: string;
    }>;
    hdel(key: string, field: string): Promise<unknown>;
    hlen(key: string): Promise<number>;
    incr(key: string): Promise<number>;
    decr(key: string): Promise<number>;
    shutdown(): void;
    protected handleSubscription: (channel: any, message: any) => void;
}
export {};

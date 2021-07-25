/// <reference types="node" />
import { EventEmitter } from 'events';
import { Presence } from './Presence';
declare type Callback = (...args: any[]) => void;
export declare class LocalPresence implements Presence {
    channels: EventEmitter;
    data: {
        [roomName: string]: string[];
    };
    hash: {
        [roomName: string]: {
            [key: string]: string;
        };
    };
    keys: {
        [name: string]: string | number;
    };
    protected subscriptions: {
        [id: string]: Callback[];
    };
    private timeouts;
    subscribe(topic: string, callback: (...args: any[]) => void): this;
    unsubscribe(topic: string, callback?: Callback): this;
    publish(topic: string, data: any): this;
    exists(roomId: string): Promise<boolean>;
    setex(key: string, value: string, seconds: number): void;
    get(key: string): string | number;
    del(key: string): void;
    sadd(key: string, value: any): void;
    smembers(key: string): Promise<string[]>;
    sismember(key: string, field: string): Promise<0 | 1>;
    srem(key: string, value: any): void;
    scard(key: string): number;
    sinter(...keys: string[]): Promise<any[]>;
    hset(key: string, field: string, value: string): void;
    hincrby(key: string, field: string, value: number): void;
    hget(key: string, field: string): Promise<string>;
    hgetall(key: string): Promise<{
        [key: string]: string;
    }>;
    hdel(key: string, field: any): void;
    hlen(key: string): Promise<number>;
    incr(key: string): Promise<string | number>;
    decr(key: string): Promise<string | number>;
    shutdown(): void;
}
export {};

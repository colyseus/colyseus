export interface Presence {
    subscribe(topic: string, callback: Function): any;
    unsubscribe(topic: string, callback?: Function): any;
    publish(topic: string, data: any): any;
    exists(roomId: string): Promise<boolean>;
    setex(key: string, value: string, seconds: number): any;
    get(key: string): any;
    del(key: string): void;
    sadd(key: string, value: any): any;
    smembers(key: string): Promise<string[]>;
    sismember(key: string, field: string): any;
    srem(key: string, value: any): any;
    scard(key: string): any;
    sinter(...keys: string[]): Promise<string[]>;
    hset(key: string, field: string, value: string): any;
    hincrby(key: string, field: string, value: number): any;
    hget(key: string, field: string): Promise<string>;
    hgetall(key: string): Promise<{
        [key: string]: string;
    }>;
    hdel(key: string, field: string): any;
    hlen(key: string): Promise<number>;
    incr(key: string): any;
    decr(key: string): any;
    shutdown(): void;
}

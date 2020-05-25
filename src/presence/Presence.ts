export interface Presence {
    subscribe(topic: string, callback: Function);
    unsubscribe(topic: string, callback?: Function);
    publish(topic: string, data: any);

    exists(roomId: string): Promise<boolean>;

    setex(key: string, value: string, seconds: number);
    get(key: string);

    del(key: string): void;
    sadd(key: string, value: any);
    smembers(key: string): Promise<string[]>;
    sismember(key: string, field: string);
    srem(key: string, value: any);
    scard(key: string);
    sinter(...keys: string[]): Promise<string[]>;

    hset(key: string, field: string, value: string);
    hincrby(key: string, field: string, value: number);
    hget(key: string, field: string): Promise<string>;
    hgetall(key: string): Promise<{ [key: string]: string }>;
    hdel(key: string, field: string);
    hlen(key: string): Promise<number>;

    incr(key: string);
    decr(key: string);
}

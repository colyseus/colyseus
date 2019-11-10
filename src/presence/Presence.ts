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
    srem(key: string, value: any);
    scard(key: string);
    sinter(...keys: string[]): Promise<string[]>;

    hset(roomId: string, key: string, value: string);
    hget(roomId: string, key: string): Promise<string>;
    hdel(roomId: string, key: string);
    hlen(roomId: string): Promise<number>;

    incr(key: string);
    decr(key: string);
}

export interface Presence {
    subscribe(topic: string, callback: Function);
    unsubscribe(topic: string);
    publish(topic: string, data: any);

    exists(roomId: string): Promise<boolean>;

    setex(key: string, value: string, seconds: number);
    get(key: string);

    del(key: string): void;
    sadd(key: string, value: any);
    smembers(key: string);
    srem(key: string, value: any);
    scard(key: string);

    hset(roomId: string, key: string, value: string);
    hget(roomId: string, key: string): Promise<string>;
    hdel(roomId: string, key: string);
    hlen(roomId: string): Promise<number>;
}

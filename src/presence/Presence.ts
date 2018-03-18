export interface Presence {
    subscribe(topic: string, callback: Function);
    unsubscribe (topic: string);
    publish(topic: string, data: any);

    exists(roomId: string): Promise<boolean>;

    del (key: string): void;
    sadd (key: string, value: any);
    smembers (key: string);
    srem (key: string, value: any);

    hset(roomId: string, key: string, value: string);
    hget(roomId: string, key: string): Promise<string>;
    hdel(roomId: string, key: string);
    hlen(roomId: string): Promise<number>;
}
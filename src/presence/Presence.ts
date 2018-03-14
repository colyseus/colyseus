export interface Presence {
    subscribe(topic: string, callback: Function);
    unsubscribe (topic: string);
    publish(topic: string, data: any);

    sadd (key: string, value: any);
    smembers (key: string);
    srem (key: string, value: any);

    hset(roomId: string, key: string, value: string);
    hget(roomId: string, key: string): Promise<string>;
}

export interface RoomPresence {
    registerRoom(roomName: string, roomId: string, pid: number);
    unregisterRoom(roomName: string, roomId: string, pid: number);
}
import redis from 'redis';
export declare function initializeProxyRedis(opts?: redis.ClientOpts, sendServerUp?: boolean): Promise<void>;
export declare function sendServerStateNotice(online: boolean): Promise<void>;
export declare function sendRoomStateNotice(roomID: string, open: boolean): Promise<void>;
export declare function getClient(): Promise<redis.RedisClient>;

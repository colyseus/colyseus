import { promisify } from 'util';

import * as redis from "redis";
import { Presence } from "./Presence";

export class RedisPresence implements Presence {
    sub: redis.RedisClient = redis.createClient();
    pub: redis.RedisClient = redis.createClient();

    protected smembersAsync = promisify(this.pub.smembers).bind(this.pub);
    protected subscriptions: {[channel: string]: (...args: any[]) => any} = {};

    subscribe(topic: string, callback: Function) {
        this.sub.subscribe(topic);

        this.subscriptions[topic] = (channel, message) => {
            if (channel === topic) {
                callback(message);
            }
        };

        this.sub.addListener("message", this.subscriptions[topic]);

        return this;
    }

    unsubscribe (topic: string) {
        this.sub.removeListener("message", this.subscriptions[topic]);

        this.sub.unsubscribe(topic);

        delete this.subscriptions[topic];
    }

    publish(topic: string, data: any) {
        this.pub.publish(topic, data);
    }

    sadd (key: string, value: any) {
        this.pub.sadd(key, value);
    }

    smembers (key: string): Promise<string[]> {
        return this.smembersAsync(key);
    }

    srem (key: string, value: any) {
        this.pub.srem(key, value);
    }

}
import fs from 'fs';
import path from 'path';

import { EventEmitter } from 'events';
import { spliceOne } from '../utils/Utils.js';
import { Presence } from './Presence.js';

import { isDevMode } from '../utils/DevMode.js';

type Callback = (...args: any[]) => void;

const DEVMODE_CACHE_FILE_PATH = path.resolve(".devmode.json");

export class LocalPresence implements Presence {
    public channels = new EventEmitter();

    public data: {[roomName: string]: string[]} = {};
    public hash: {[roomName: string]: {[key: string]: string}} = {};

    public keys: {[name: string]: string | number} = {};

    protected subscriptions: {[id: string]: Callback[]} = {};
    private timeouts: {[name: string]: NodeJS.Timeout} = {};

    constructor() {
      //
      // reload from local cache on devMode
      //
      if (
        isDevMode &&
        fs.existsSync(DEVMODE_CACHE_FILE_PATH)
      ) {
        const cache = fs.readFileSync(DEVMODE_CACHE_FILE_PATH).toString('utf-8') || "{}";
        const parsed = JSON.parse(cache);
        if (parsed.data) { this.data = parsed.data; }
        if (parsed.hash) { this.hash = parsed.hash; }
        if (parsed.keys) { this.keys = parsed.keys; }
      }
    }

    public subscribe(topic: string, callback: (...args: any[]) => void) {
        if (!this.subscriptions[topic]) { this.subscriptions[topic] = []; }
        this.subscriptions[topic].push(callback);
        this.channels.on(topic, callback);
        return this;
    }

    public unsubscribe(topic: string, callback?: Callback) {
        const topicCallbacks = this.subscriptions[topic];
        if (!topicCallbacks) { return; }

        if (callback)  {
            const idx = topicCallbacks.indexOf(callback);
            if (idx !== -1) {
                topicCallbacks.splice(idx, 1);
                this.channels.removeListener(topic, callback);
            }

            if (topicCallbacks.length === 0) {
                delete this.subscriptions[topic];
            }

        } else {
          topicCallbacks.forEach((cb) =>
            this.channels.removeListener(topic, cb));

          delete this.subscriptions[topic];
        }

        return this;
    }

    public publish(topic: string, data: any) {
        this.channels.emit(topic, data);
        return this;
    }

    public async exists(key: string): Promise<boolean> {
        return this.channels.listenerCount(key) > 0;
    }

    public set(key: string, value: string) {
        this.keys[key] = value;
    }

    public setex(key: string, value: string, seconds: number) {
        this.keys[key] = value;
        this.expire(key, seconds);
    }

    public expire(key: string, seconds: number) {
        // ensure previous timeout is clear before setting another one.
        if (this.timeouts[key]) {
            clearTimeout(this.timeouts[key]);
        }
        this.timeouts[key] = setTimeout(() => {
            delete this.keys[key];
            delete this.timeouts[key];
        }, seconds * 1000);
    }

    public get(key: string) {
        return this.keys[key];
    }

    public del(key: string) {
        delete this.keys[key];
        delete this.data[key];
        delete this.hash[key];
    }

    public sadd(key: string, value: any) {
        if (!this.data[key]) {
            this.data[key] = [];
        }

        if (this.data[key].indexOf(value) === -1) {
            this.data[key].push(value);
        }
    }

    public async smembers(key: string): Promise<string[]> {
        return this.data[key] || [];
    }

    public async sismember(key: string, field: string) {
        return this.data[key] && this.data[key].includes(field) ? 1 : 0;
    }

    public srem(key: string, value: any) {
        if (this.data[key]) {
            spliceOne(this.data[key], this.data[key].indexOf(value));
        }
    }

    public scard(key: string) {
        return (this.data[key] || []).length;
    }

    public async sinter(...keys: string[]) {
      const intersection: {[value: string]: number} = {};

      for (let i = 0, l = keys.length; i < l; i++) {
        (await this.smembers(keys[i])).forEach((member) => {
          if (!intersection[member]) {
            intersection[member] = 0;
          }

          intersection[member]++;
        });
      }

      return Object.keys(intersection).reduce((prev, curr) => {
        if (intersection[curr] > 1) {
          prev.push(curr);
        }
        return prev;
      }, []);
    }

    public hset(key: string, field: string, value: string) {
        if (!this.hash[key]) { this.hash[key] = {}; }
        this.hash[key][field] = value;
    }

    public hincrby(key: string, field: string, incrBy: number) {
        if (!this.hash[key]) { this.hash[key] = {}; }
        let value = Number(this.hash[key][field] || '0');
        value += incrBy;
        this.hash[key][field] = value.toString();
        return value;
    }

    public hincrbyex(key: string, field: string, incrBy: number, expireInSeconds: number) {
        if (!this.hash[key]) { this.hash[key] = {}; }
        let value = Number(this.hash[key][field] || '0');
        value += incrBy;
        this.hash[key][field] = value.toString();
        this.setex(key, field, expireInSeconds);
        return value;
    }

    public async hget(key: string, field: string) {
        return this.hash[key] && this.hash[key][field];
    }

    public async hgetall(key: string) {
        return this.hash[key] || {};
    }

    public hdel(key: string, field: any) {
        const success = this.hash?.[key]?.[field] !== undefined;
        if (success) {
            delete this.hash[key][field];
        }
        return success;
    }

    public async hlen(key: string) {
        return this.hash[key] && Object.keys(this.hash[key]).length || 0;
    }

    public async incr(key: string) {
        if (!this.keys[key]) {
            this.keys[key] = 0;
        }
        (this.keys[key] as number)++;
        return Promise.resolve(this.keys[key] as number);
    }

    public async decr(key: string) {
        if (!this.keys[key]) {
            this.keys[key] = 0;
        }
        (this.keys[key] as number)--;
        return Promise.resolve(this.keys[key] as number);
    }

    public llen(key: string): number {
      return (this.data[key] && this.data[key].length) || 0;
    }

    public rpush(key: string, ...values: string[]): number {
      if (!this.data[key]) { this.data[key] = []; }

      let lastLength: number = 0;

      values.forEach(value => {
        lastLength = this.data[key].push(value);
      });

      return lastLength;
    }

    public lpush(key: string, ...values: string[]): number {
      if (!this.data[key]) { this.data[key] = []; }

      let lastLength: number = 0;

      values.forEach(value => {
        lastLength = this.data[key].unshift(value);
      });

      return lastLength;
    }


    public lpop(key: string): string {
      return Array.isArray(this.data[key]) && this.data[key].shift();
    }

    public rpop(key: string): string {
      return this.data[key].pop();
    }

    public brpop(...args: [...keys: string[], timeoutInSeconds: number]): Promise<[string, string] | null> {
      const keys = args.slice(0, -2) as string[];
      const timeoutInSeconds = args[args.length - 1] as number;

      const getFirstPopulated = (): [string, string] | null => {
        const keyWithValue = keys.find(key => this.data[key] && this.data[key].length > 0);
        if (keyWithValue) {
          return [keyWithValue, this.data[keyWithValue].pop()];
        } else {
          return null;
        }
      }

      const firstPopulated = getFirstPopulated();

      if (firstPopulated) {
        // return first populated key + item
        return Promise.resolve(firstPopulated);

      } else {
        // 8 retries per second
        const maxRetries = timeoutInSeconds * 8;

        let tries = 0;
        return new Promise((resolve) => {
          const interval = setInterval(() => {
            tries++;

            const firstPopulated = getFirstPopulated();
            if (firstPopulated) {
              clearInterval(interval);
              return resolve(firstPopulated);

            } else if (tries >= maxRetries) {
              clearInterval(interval);
              return resolve(undefined);
            }

          }, (timeoutInSeconds * 1000) / maxRetries);
        });
      }
    }

    public shutdown() {
      if (isDevMode) {
        const cache = JSON.stringify({
          data: this.data,
          hash: this.hash,
          keys: this.keys
        });
        fs.writeFileSync(DEVMODE_CACHE_FILE_PATH, cache, { encoding: "utf-8" });
      }
    }

}

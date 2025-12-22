
import { EventEmitter } from 'events';
import { spliceOne } from '../utils/Utils.ts';
import type { Presence } from './Presence.ts';

import { hasDevModeCache, isDevMode, getDevModeCache, writeDevModeCache } from '../utils/DevMode.ts';

type Callback = (...args: any[]) => void;

export class LocalPresence implements Presence {
    public subscriptions = new EventEmitter();

    public data: {[roomName: string]: string[]} = {};
    public hash: {[roomName: string]: {[key: string]: string}} = {};

    public keys: {[name: string]: string | number} = {};

    private timeouts: {[name: string]: NodeJS.Timeout} = {};

    constructor() {
      //
      // reload from local cache on devMode
      //
      if (
        isDevMode &&
        hasDevModeCache()
      ) {
        const cache = getDevModeCache();
        if (cache.data) { this.data = cache.data; }
        if (cache.hash) { this.hash = cache.hash; }
        if (cache.keys) { this.keys = cache.keys; }
      }
    }

    public subscribe(topic: string, callback: (...args: any[]) => void) {
        this.subscriptions.on(topic, callback);
        return Promise.resolve(this);
    }

    public unsubscribe(topic: string, callback?: Callback) {
        if (callback)  {
            this.subscriptions.removeListener(topic, callback);

        } else {
            this.subscriptions.removeAllListeners(topic);
        }

        return this;
    }

    public publish(topic: string, data: any) {
        this.subscriptions.emit(topic, data);
        return this;
    }

    public async channels (pattern?: string) {
      let eventNames = this.subscriptions.eventNames() as string[];
      if (pattern) {
        //
        // This is a limited glob pattern to regexp implementation.
        // If needed, we can use a full implementation like picomatch: https://github.com/micromatch/picomatch/
        //
        const regexp = new RegExp(
          pattern.
            replaceAll(".", "\\.").
            replaceAll("$", "\\$").
            replaceAll("*", ".*").
            replaceAll("?", "."),
          "i"
        );
        eventNames = eventNames.filter((eventName) => regexp.test(eventName));
      }
      return eventNames;
    }

    public async exists(key: string): Promise<boolean> {
        return (
          this.keys[key] !== undefined ||
          this.data[key] !== undefined ||
          this.hash[key] !== undefined
        );
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
        return Promise.resolve(true);
    }

    public hincrby(key: string, field: string, incrBy: number) {
        if (!this.hash[key]) { this.hash[key] = {}; }
        let value = Number(this.hash[key][field] || '0');
        value += incrBy;
        this.hash[key][field] = value.toString();
        return Promise.resolve(value);
    }

    public hincrbyex(key: string, field: string, incrBy: number, expireInSeconds: number) {
        if (!this.hash[key]) { this.hash[key] = {}; }
        let value = Number(this.hash[key][field] || '0');
        value += incrBy;
        this.hash[key][field] = value.toString();

        //
        // FIXME: delete only hash[key][field]
        // (we can't use "HEXPIRE" in Redis because it's only available since Redis version 7.4.0+)
        //
        if (this.timeouts[key]) {
          clearTimeout(this.timeouts[key]);
        }
        this.timeouts[key] = setTimeout(() => {
            delete this.hash[key];
            delete this.timeouts[key];
        }, expireInSeconds * 1000);

        return Promise.resolve(value);
    }

    public async hget(key: string, field: string) {
        return (typeof(this.hash[key]) === 'object')
          ? this.hash[key][field] ?? null
          : null;
    }

    public async hgetall(key: string) {
        return this.hash[key] || {};
    }

    public hdel(key: string, field: any) {
        const success = this.hash?.[key]?.[field] !== undefined;
        if (success) {
            delete this.hash[key][field];
        }
        return Promise.resolve(success);
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

    public llen(key: string) {
      return Promise.resolve((this.data[key] && this.data[key].length) || 0);
    }

    public rpush(key: string, ...values: string[]): Promise<number> {
      if (!this.data[key]) { this.data[key] = []; }

      let lastLength: number = 0;

      values.forEach(value => {
        lastLength = this.data[key].push(value);
      });

      return Promise.resolve(lastLength);
    }

    public lpush(key: string, ...values: string[]): Promise<number> {
      if (!this.data[key]) { this.data[key] = []; }

      let lastLength: number = 0;

      values.forEach(value => {
        lastLength = this.data[key].unshift(value);
      });

      return Promise.resolve(lastLength);
    }

    public lpop(key: string): Promise<string> {
      return Promise.resolve(Array.isArray(this.data[key])
        ? this.data[key].shift()
        : null);
    }

    public rpop(key: string): Promise<string | null> {
      return Promise.resolve(this.data[key].pop());
    }

    public brpop(...args: [...keys: string[], timeoutInSeconds: number]): Promise<[string, string] | null> {
      const keys = args.slice(0, -1) as string[];
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
              return resolve(null);
            }

          }, (timeoutInSeconds * 1000) / maxRetries);
        });
      }
    }

    public setMaxListeners(number: number) {
      this.subscriptions.setMaxListeners(number);
    }

    public shutdown() {
      if (isDevMode) {
        writeDevModeCache({
          data: this.data,
          hash: this.hash,
          keys: this.keys
        });
      }
    }

}

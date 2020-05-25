import { EventEmitter } from 'events';
import { spliceOne } from '../Utils';
import { Presence } from './Presence';

type Callback = (...args: any[]) => void;

export class LocalPresence implements Presence {
    public channels = new EventEmitter();

    public data: {[roomName: string]: string[]} = {};
    public hash: {[roomName: string]: {[key: string]: string}} = {};

    public keys: {[name: string]: string | number} = {};

    private listenersByTopic: {[id: string]: Callback[]} = {};
    private timeouts: {[name: string]: NodeJS.Timer} = {};

    public subscribe(topic: string, callback: (...args: any[]) => void) {
        if (!this.listenersByTopic[topic]) { this.listenersByTopic[topic] = []; }
        this.listenersByTopic[topic].push(callback);
        this.channels.on(topic, callback);
        return this;
    }

    public unsubscribe(topic: string, callback?: Callback) {
        if (callback)  {
            const idx = this.listenersByTopic[topic].indexOf(callback);
            if (idx !== -1) {
                this.listenersByTopic[topic].splice(idx, 1);
                this.channels.removeListener(topic, callback);
            }

        } else if (this.listenersByTopic[topic]) {
          this.listenersByTopic[topic].forEach((cb) => this.channels.removeListener(topic, cb));
          delete this.listenersByTopic[topic];
        }
        return this;
    }

    public publish(topic: string, data: any) {
        this.channels.emit(topic, data);
        return this;
    }

    public async exists(roomId: string): Promise<boolean> {
        return this.channels.listenerCount(roomId) > 0;
    }

    public setex(key: string, value: string, seconds: number) {
        // ensure previous timeout is clear before setting another one.
        if (this.timeouts[key]) {
            clearTimeout(this.timeouts[key]);
        }

        this.keys[key] = value;
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

    public hincrby(key: string, field: string, value: number) {
        if (!this.hash[key]) { this.hash[key] = {}; }
        const previousValue = Number(this.hash[key][field] || '0');
        this.hash[key][field] = (previousValue + value).toString();
    }

    public async hget(key: string, field: string) {
        return this.hash[key] && this.hash[key][field];
    }

    public async hgetall(key: string) {
        return this.hash[key] || {};
    }

    public hdel(key: string, field: any) {
        if (this.hash[key]) {
            delete this.hash[key][field];
        }
    }

    public async hlen(key: string) {
        return this.hash[key] && Object.keys(this.hash[key]).length || 0;
    }

    public async incr(key: string) {
        if (!this.keys[key]) {
            this.keys[key] = 0;
        }
        (this.keys[key] as number)++;
        return this.keys[key];
    }

    public async decr(key: string) {
        if (!this.keys[key]) {
            this.keys[key] = 0;
        }
        (this.keys[key] as number)--;
        return this.keys[key];
    }

}

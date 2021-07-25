"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RedisPresence = void 0;
const redis_1 = __importDefault(require("redis"));
const util_1 = require("util");
class RedisPresence {
    constructor(opts, prefix) {
        this.subscriptions = {};
        this.handleSubscription = (channel, message) => {
            if (this.subscriptions[channel]) {
                for (let i = 0, l = this.subscriptions[channel].length; i < l; i++) {
                    this.subscriptions[channel][i](JSON.parse(message));
                }
            }
        };
        this.sub = redis_1.default.createClient(opts);
        this.pub = redis_1.default.createClient(opts);
        this.prefix = (prefix !== undefined) ? prefix : "";
        // no listener limit
        this.sub.setMaxListeners(0);
        // create promisified pub/sub methods.
        this.subscribeAsync = util_1.promisify(this.sub.subscribe).bind(this.sub);
        this.unsubscribeAsync = util_1.promisify(this.sub.unsubscribe).bind(this.sub);
        this.publishAsync = util_1.promisify(this.pub.publish).bind(this.pub);
        // create promisified redis methods.
        this.smembersAsync = util_1.promisify(this.pub.smembers).bind(this.pub);
        this.sismemberAsync = util_1.promisify(this.pub.sismember).bind(this.pub);
        this.hgetAsync = util_1.promisify(this.pub.hget).bind(this.pub);
        this.hlenAsync = util_1.promisify(this.pub.hlen).bind(this.pub);
        this.pubsubAsync = util_1.promisify(this.pub.pubsub).bind(this.pub);
        this.incrAsync = util_1.promisify(this.pub.incr).bind(this.pub);
        this.decrAsync = util_1.promisify(this.pub.decr).bind(this.pub);
    }
    async subscribe(topic, callback) {
        topic = this.prefix + topic;
        if (!this.subscriptions[topic]) {
            this.subscriptions[topic] = [];
        }
        this.subscriptions[topic].push(callback);
        if (this.sub.listeners('message').length === 0) {
            this.sub.addListener('message', this.handleSubscription);
        }
        await this.subscribeAsync(topic);
        return this;
    }
    async unsubscribe(topic, callback) {
        topic = this.prefix + topic;
        const topicCallbacks = this.subscriptions[topic];
        if (!topicCallbacks) {
            return;
        }
        if (callback) {
            const index = topicCallbacks.indexOf(callback);
            topicCallbacks.splice(index, 1);
        }
        else {
            this.subscriptions[topic] = [];
        }
        if (this.subscriptions[topic].length === 0) {
            delete this.subscriptions[topic];
            await this.unsubscribeAsync(topic);
        }
        return this;
    }
    async publish(topic, data) {
        topic = this.prefix + topic;
        if (data === undefined) {
            data = false;
        }
        await this.publishAsync(topic, JSON.stringify(data));
    }
    async exists(roomId) {
        roomId = this.prefix + roomId;
        return (await this.pubsubAsync('channels', roomId)).length > 0;
    }
    async setex(key, value, seconds) {
        key = this.prefix + key;
        return new Promise((resolve) => this.pub.setex(key, seconds, value, resolve));
    }
    async get(key) {
        key = this.prefix + key;
        return new Promise((resolve, reject) => {
            this.pub.get(key, (err, data) => {
                if (err) {
                    return reject(err);
                }
                resolve(data);
            });
        });
    }
    async del(roomId) {
        roomId = this.prefix + roomId;
        return new Promise((resolve) => {
            this.pub.del(roomId, resolve);
        });
    }
    async sadd(key, value) {
        key = this.prefix + key;
        return new Promise((resolve) => {
            this.pub.sadd(key, value, resolve);
        });
    }
    async smembers(key) {
        key = this.prefix + key;
        return await this.smembersAsync(key);
    }
    async sismember(key, field) {
        key = this.prefix + key;
        return await this.sismemberAsync(key, field);
    }
    async srem(key, value) {
        key = this.prefix + key;
        return new Promise((resolve) => {
            this.pub.srem(key, value, resolve);
        });
    }
    async scard(key) {
        key = this.prefix + key;
        return new Promise((resolve, reject) => {
            this.pub.scard(key, (err, data) => {
                if (err) {
                    return reject(err);
                }
                resolve(data);
            });
        });
    }
    async sinter(...keys) {
        for (let index = 0; index < keys.length; index++) {
            const tkey = keys[index];
            keys[index] = this.prefix + tkey;
        }
        return new Promise((resolve, reject) => {
            this.pub.sinter(...keys, (err, data) => {
                if (err) {
                    return reject(err);
                }
                resolve(data);
            });
        });
    }
    async hset(key, field, value) {
        key = this.prefix + key;
        return new Promise((resolve) => {
            this.pub.hset(key, field, value, resolve);
        });
    }
    async hincrby(key, field, value) {
        key = this.prefix + key;
        return new Promise((resolve) => {
            this.pub.hincrby(key, field, value, resolve);
        });
    }
    async hget(key, field) {
        key = this.prefix + key;
        return await this.hgetAsync(key, field);
    }
    async hgetall(key) {
        key = this.prefix + key;
        return new Promise((resolve, reject) => {
            this.pub.hgetall(key, (err, values) => {
                if (err) {
                    return reject(err);
                }
                resolve(values);
            });
        });
    }
    async hdel(key, field) {
        key = this.prefix + key;
        return new Promise((resolve, reject) => {
            this.pub.hdel(key, field, (err, ok) => {
                if (err) {
                    return reject(err);
                }
                resolve(ok);
            });
        });
    }
    async hlen(key) {
        key = this.prefix + key;
        return await this.hlenAsync(key);
    }
    async incr(key) {
        key = this.prefix + key;
        return await this.incrAsync(key);
    }
    async decr(key) {
        key = this.prefix + key;
        return await this.decrAsync(key);
    }
    shutdown() {
        this.sub.quit();
        this.pub.quit();
    }
}
exports.RedisPresence = RedisPresence;
//# sourceMappingURL=index.js.map
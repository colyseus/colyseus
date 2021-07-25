"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LocalPresence = void 0;
const events_1 = require("events");
const Utils_1 = require("../Utils");
class LocalPresence {
    constructor() {
        this.channels = new events_1.EventEmitter();
        this.data = {};
        this.hash = {};
        this.keys = {};
        this.subscriptions = {};
        this.timeouts = {};
    }
    subscribe(topic, callback) {
        if (!this.subscriptions[topic]) {
            this.subscriptions[topic] = [];
        }
        this.subscriptions[topic].push(callback);
        this.channels.on(topic, callback);
        return this;
    }
    unsubscribe(topic, callback) {
        const topicCallbacks = this.subscriptions[topic];
        if (!topicCallbacks) {
            return;
        }
        if (callback) {
            const idx = topicCallbacks.indexOf(callback);
            if (idx !== -1) {
                topicCallbacks.splice(idx, 1);
                this.channels.removeListener(topic, callback);
            }
            if (topicCallbacks.length === 0) {
                delete this.subscriptions[topic];
            }
        }
        else {
            topicCallbacks.forEach((cb) => this.channels.removeListener(topic, cb));
            delete this.subscriptions[topic];
        }
        return this;
    }
    publish(topic, data) {
        this.channels.emit(topic, data);
        return this;
    }
    async exists(roomId) {
        return this.channels.listenerCount(roomId) > 0;
    }
    setex(key, value, seconds) {
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
    get(key) {
        return this.keys[key];
    }
    del(key) {
        delete this.keys[key];
        delete this.data[key];
        delete this.hash[key];
    }
    sadd(key, value) {
        if (!this.data[key]) {
            this.data[key] = [];
        }
        if (this.data[key].indexOf(value) === -1) {
            this.data[key].push(value);
        }
    }
    async smembers(key) {
        return this.data[key] || [];
    }
    async sismember(key, field) {
        return this.data[key] && this.data[key].includes(field) ? 1 : 0;
    }
    srem(key, value) {
        if (this.data[key]) {
            Utils_1.spliceOne(this.data[key], this.data[key].indexOf(value));
        }
    }
    scard(key) {
        return (this.data[key] || []).length;
    }
    async sinter(...keys) {
        const intersection = {};
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
    hset(key, field, value) {
        if (!this.hash[key]) {
            this.hash[key] = {};
        }
        this.hash[key][field] = value;
    }
    hincrby(key, field, value) {
        if (!this.hash[key]) {
            this.hash[key] = {};
        }
        const previousValue = Number(this.hash[key][field] || '0');
        this.hash[key][field] = (previousValue + value).toString();
    }
    async hget(key, field) {
        return this.hash[key] && this.hash[key][field];
    }
    async hgetall(key) {
        return this.hash[key] || {};
    }
    hdel(key, field) {
        if (this.hash[key]) {
            delete this.hash[key][field];
        }
    }
    async hlen(key) {
        return this.hash[key] && Object.keys(this.hash[key]).length || 0;
    }
    async incr(key) {
        if (!this.keys[key]) {
            this.keys[key] = 0;
        }
        this.keys[key]++;
        return this.keys[key];
    }
    async decr(key) {
        if (!this.keys[key]) {
            this.keys[key] = 0;
        }
        this.keys[key]--;
        return this.keys[key];
    }
    shutdown() {
        // noop
    }
}
exports.LocalPresence = LocalPresence;
//# sourceMappingURL=LocalPresence.js.map
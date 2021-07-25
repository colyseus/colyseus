"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.merge = exports.spliceOne = exports.Deferred = exports.retry = exports.registerGracefulShutdown = exports.generateId = exports.REMOTE_ROOM_SHORT_TIMEOUT = void 0;
const nanoid_1 = require("nanoid");
const Debug_1 = require("./Debug");
// remote room call timeouts
exports.REMOTE_ROOM_SHORT_TIMEOUT = Number(process.env.COLYSEUS_PRESENCE_SHORT_TIMEOUT || 2000);
function generateId(length = 9) {
    return nanoid_1.nanoid(length);
}
exports.generateId = generateId;
//
// nodemon sends SIGUSR2 before reloading
// (https://github.com/remy/nodemon#controlling-shutdown-of-your-script)
//
const signals = ['SIGINT', 'SIGTERM', 'SIGUSR2'];
function registerGracefulShutdown(callback) {
    /**
     * Gracefully shutdown on uncaught errors
     */
    process.on('uncaughtException', (err) => {
        Debug_1.debugAndPrintError(err);
        callback(err);
    });
    signals.forEach((signal) => process.once(signal, () => callback()));
}
exports.registerGracefulShutdown = registerGracefulShutdown;
function retry(cb, maxRetries = 3, errorWhiteList = [], retries = 0) {
    return new Promise((resolve, reject) => {
        cb()
            .then(resolve)
            .catch((e) => {
            if (errorWhiteList.indexOf(e.constructor) !== -1 &&
                retries++ < maxRetries) {
                setTimeout(() => {
                    retry(cb, maxRetries, errorWhiteList, retries).
                        then(resolve).
                        catch((e2) => reject(e2));
                }, Math.floor(Math.random() * Math.pow(2, retries) * 400));
            }
            else {
                reject(e);
            }
        });
    });
}
exports.retry = retry;
class Deferred {
    constructor() {
        this.promise = new Promise((resolve, reject) => {
            this.resolve = resolve;
            this.reject = reject;
        });
    }
    then(func) {
        return this.promise.then.apply(this.promise, arguments);
    }
    catch(func) {
        return this.promise.catch(func);
    }
}
exports.Deferred = Deferred;
function spliceOne(arr, index) {
    // manually splice availableRooms array
    // http://jsperf.com/manual-splice
    if (index === -1 || index >= arr.length) {
        return false;
    }
    const len = arr.length - 1;
    for (let i = index; i < len; i++) {
        arr[i] = arr[i + 1];
    }
    arr.length = len;
    return true;
}
exports.spliceOne = spliceOne;
function merge(a, ...objs) {
    for (let i = 0, len = objs.length; i < len; i++) {
        const b = objs[i];
        for (const key in b) {
            if (b.hasOwnProperty(key)) {
                a[key] = b[key];
            }
        }
    }
    return a;
}
exports.merge = merge;
//# sourceMappingURL=Utils.js.map
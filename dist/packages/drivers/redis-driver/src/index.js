"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RedisDriver = void 0;
const redis_1 = __importDefault(require("redis"));
const util_1 = require("util");
const Query_1 = require("./Query");
const RoomData_1 = require("./RoomData");
class RedisDriver {
    constructor(options, key = 'roomcaches') {
        this._cachekey = key;
        this._client = redis_1.default.createClient(options);
        this.hgetall = util_1.promisify(this._client.hgetall).bind(this._client);
    }
    createInstance(initialValues = {}) {
        return new RoomData_1.RoomData(initialValues, this._client, this._cachekey);
    }
    async find(conditions) {
        const rooms = await this.getRooms();
        return rooms.filter((room) => {
            if (!room.roomId) {
                return false;
            }
            for (const field in conditions) {
                if (conditions.hasOwnProperty(field) &&
                    room[field] !== conditions[field]) {
                    return false;
                }
            }
            return true;
        });
    }
    findOne(conditions) {
        return new Query_1.Query(this.getRooms(), conditions);
    }
    async getRooms() {
        return Object.entries(await this.hgetall(this._cachekey) ?? []).map(([, roomcache]) => new RoomData_1.RoomData(JSON.parse(roomcache), this._client, this._cachekey));
    }
    clear() {
        this._client.del(this._cachekey);
    }
    shutdown() {
        this._client.quit();
    }
}
exports.RedisDriver = RedisDriver;
//# sourceMappingURL=index.js.map
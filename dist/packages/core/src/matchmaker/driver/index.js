"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LocalDriver = void 0;
const Query_1 = require("./Query");
const RoomData_1 = require("./RoomData");
class LocalDriver {
    constructor() {
        this.rooms = [];
    }
    createInstance(initialValues = {}) {
        return new RoomData_1.RoomCache(initialValues, this.rooms);
    }
    find(conditions) {
        return this.rooms.filter(((room) => {
            for (const field in conditions) {
                if (conditions.hasOwnProperty(field) &&
                    room[field] !== conditions[field]) {
                    return false;
                }
            }
            return true;
        }));
    }
    findOne(conditions) {
        return new Query_1.Query(this.rooms, conditions);
    }
    clear() {
        this.rooms = [];
    }
    shutdown() { }
}
exports.LocalDriver = LocalDriver;
//# sourceMappingURL=index.js.map
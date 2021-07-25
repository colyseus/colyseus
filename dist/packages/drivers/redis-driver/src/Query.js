"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Query = void 0;
class Query {
    constructor(rooms, conditions) {
        this.order = new Map();
        this.conditions = conditions;
        this.rooms = rooms;
    }
    sort(options) {
        this.order.clear();
        const fields = Object.entries(options);
        if (fields.length) {
            for (const [field, direction] of fields) {
                if (direction === 1 || direction === 'asc' || direction === 'ascending') {
                    this.order.set(field, 1);
                }
                else {
                    this.order.set(field, -1);
                }
            }
        }
        return this;
    }
    then(resolve, reject) {
        return this.rooms.then(rooms => {
            if (this.order.size) {
                rooms.sort((room1, room2) => {
                    for (const [field, direction] of this.order) {
                        if (direction === 1) {
                            if (room1[field] > room2[field])
                                return 1;
                            if (room1[field] < room2[field])
                                return -1;
                        }
                        else {
                            if (room1[field] > room2[field])
                                return -1;
                            if (room1[field] < room2[field])
                                return 1;
                        }
                    }
                });
            }
            let conditions = Object.entries(this.conditions);
            let withConditions = conditions.length > 0;
            return resolve(rooms.find((room) => {
                if (withConditions) {
                    for (let [field, value] of conditions) {
                        if (room[field] !== value) {
                            return false;
                        }
                    }
                }
                return true;
            }));
        });
    }
}
exports.Query = Query;
//# sourceMappingURL=Query.js.map
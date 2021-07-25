"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Query = void 0;
class Query {
    constructor(rooms, conditions) {
        this.$rooms = rooms.slice(0);
        this.conditions = conditions;
    }
    sort(options) {
        this.$rooms = this.$rooms.sort((room1, room2) => {
            for (const field in options) {
                if (options.hasOwnProperty(field)) {
                    const direction = options[field];
                    const isAscending = (direction === 1 || direction === 'asc' || direction === 'ascending');
                    if (isAscending) {
                        if (room1[field] > room2[field]) {
                            return 1;
                        }
                        if (room1[field] < room2[field]) {
                            return -1;
                        }
                    }
                    else {
                        if (room1[field] > room2[field]) {
                            return -1;
                        }
                        if (room1[field] < room2[field]) {
                            return 1;
                        }
                    }
                }
            }
        });
    }
    then(resolve, reject) {
        const result = this.$rooms.find(((room) => {
            for (const field in this.conditions) {
                if (this.conditions.hasOwnProperty(field) &&
                    room[field] !== this.conditions[field]) {
                    return false;
                }
            }
            return true;
        }));
        return resolve(result);
    }
}
exports.Query = Query;
//# sourceMappingURL=Query.js.map
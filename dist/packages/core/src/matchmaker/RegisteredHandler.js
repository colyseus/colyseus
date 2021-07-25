"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RegisteredHandler = exports.INVALID_OPTION_KEYS = void 0;
const events_1 = require("events");
const Lobby_1 = require("./Lobby");
exports.INVALID_OPTION_KEYS = [
    'clients',
    'locked',
    'private',
    // 'maxClients', - maxClients can be useful as filter options
    'metadata',
    'name',
    'processId',
    'roomId',
];
class RegisteredHandler extends events_1.EventEmitter {
    constructor(klass, options) {
        super();
        this.filterOptions = [];
        if (typeof (klass) !== 'function') {
            console.debug('You are likely not importing your room class correctly.');
            throw new Error(`class is expected but ${typeof (klass)} was provided.`);
        }
        this.klass = klass;
        this.options = options;
    }
    enableRealtimeListing() {
        this.on('create', (room) => Lobby_1.updateLobby(room));
        this.on('lock', (room) => Lobby_1.updateLobby(room));
        this.on('unlock', (room) => Lobby_1.updateLobby(room));
        this.on('join', (room) => Lobby_1.updateLobby(room));
        this.on('leave', (room, _, willDispose) => {
            if (!willDispose) {
                Lobby_1.updateLobby(room);
            }
        });
        this.on('dispose', (room) => Lobby_1.updateLobby(room, true));
        return this;
    }
    filterBy(options) {
        this.filterOptions = options;
        return this;
    }
    sortBy(options) {
        this.sortOptions = options;
        return this;
    }
    getFilterOptions(options) {
        return this.filterOptions.reduce((prev, curr, i, arr) => {
            const field = arr[i];
            if (options[field]) {
                if (exports.INVALID_OPTION_KEYS.indexOf(field) !== -1) {
                    console.warn(`option "${field}" has internal usage and is going to be ignored.`);
                }
                else {
                    prev[field] = options[field];
                }
            }
            return prev;
        }, {});
    }
}
exports.RegisteredHandler = RegisteredHandler;
//# sourceMappingURL=RegisteredHandler.js.map
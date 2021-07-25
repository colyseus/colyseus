"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LobbyRoom = void 0;
const matchMaker = __importStar(require("../MatchMaker"));
const Lobby_1 = require("../matchmaker/Lobby");
const Room_1 = require("../Room");
class LobbyRoom extends Room_1.Room {
    constructor() {
        super(...arguments);
        this.rooms = [];
        this.clientOptions = {};
    }
    async onCreate(options) {
        // prevent LobbyRoom to notify itself
        this.listing.unlisted = true;
        this.unsubscribeLobby = await Lobby_1.subscribeLobby((roomId, data) => {
            const roomIndex = this.rooms.findIndex((room) => room.roomId === roomId);
            // console.log("LOBBY RECEIVING UPDATE:", { roomId, data, roomIndex });
            if (!data) {
                // remove room listing data
                if (roomIndex !== -1) {
                    const previousData = this.rooms[roomIndex];
                    this.rooms.splice(roomIndex, 1);
                    this.clients.forEach((client) => {
                        if (this.filterItemForClient(previousData, this.clientOptions[client.sessionId].filter)) {
                            client.send('-', roomId);
                        }
                    });
                }
            }
            else if (roomIndex === -1) {
                // append room listing data
                this.rooms.push(data);
                this.clients.forEach((client) => {
                    if (this.filterItemForClient(data, this.clientOptions[client.sessionId].filter)) {
                        client.send('+', [roomId, data]);
                    }
                });
            }
            else {
                const previousData = this.rooms[roomIndex];
                // replace room listing data
                this.rooms[roomIndex] = data;
                this.clients.forEach((client) => {
                    const hadData = this.filterItemForClient(previousData, this.clientOptions[client.sessionId].filter);
                    const hasData = this.filterItemForClient(data, this.clientOptions[client.sessionId].filter);
                    if (hadData && !hasData) {
                        client.send('-', roomId);
                    }
                    else if (hasData) {
                        client.send('+', [roomId, data]);
                    }
                });
            }
        });
        this.rooms = await matchMaker.query({ private: false, unlisted: false });
        this.onMessage('filter', (client, filter) => {
            this.clientOptions[client.sessionId].filter = filter;
            client.send('rooms', this.filterItemsForClient(this.clientOptions[client.sessionId]));
        });
    }
    onJoin(client, options) {
        this.clientOptions[client.sessionId] = options || {};
        client.send('rooms', this.filterItemsForClient(this.clientOptions[client.sessionId]));
    }
    onLeave(client) {
        delete this.clientOptions[client.sessionId];
    }
    onDispose() {
        if (this.unsubscribeLobby) {
            this.unsubscribeLobby();
        }
    }
    filterItemsForClient(options) {
        const filter = options.filter;
        return (filter)
            ? this.rooms.filter((room) => this.filterItemForClient(room, filter))
            : this.rooms;
    }
    filterItemForClient(room, filter) {
        if (!filter) {
            return true;
        }
        let isAllowed = true;
        if (filter.name !== room.name) {
            isAllowed = false;
        }
        if (filter.metadata) {
            for (const field in filter.metadata) {
                if (room.metadata[field] !== filter.metadata[field]) {
                    isAllowed = false;
                    break;
                }
            }
        }
        return isAllowed;
    }
}
exports.LobbyRoom = LobbyRoom;
//# sourceMappingURL=LobbyRoom.js.map
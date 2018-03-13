import { RoomPresence } from './Presence';
import { RedisPresence } from './RedisPresence';

export class DefaultRoomPresence implements RoomPresence {
    rooms: {[name: string]: {[roomId: string]: number}} = {};
    adapter: RedisPresence;

    registerRoom (roomName: string, roomId: string, pid: number) {
        if (!this.rooms[roomName]) {
            this.rooms[roomName] = {};
        }

        this.rooms[roomName][roomId] = pid;
    }

    unregisterRoom (roomName: string, roomId: string, pid: number) {
        delete this.rooms[roomName][roomId];
    }

}
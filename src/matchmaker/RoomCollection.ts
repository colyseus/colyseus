import { Room } from '../Room';

export class RoomCollection<T=Room> {
    byName: { [roomName: string]: T[] } = {};
    byId: { [id: string]: T } = {};

    setById(id: string, room: T) {
        this.byId[id] = room;
    }

    getById(id: string): T {
        return this.byId[id];
    }

    deleteById (id: string) {
        delete this.byId[id];
    }
}
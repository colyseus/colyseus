import { debugMatchMaking } from '../../Debug.ts';
import type { IRoomCache, SortOptions, MatchMakerDriver } from '../driver.ts';
import { Query } from './Query.ts';

// re-export
export type { IRoomCache, SortOptions, MatchMakerDriver };

export class LocalDriver implements MatchMakerDriver {
  public rooms: IRoomCache[] = [];

  // the roomIds in `rooms`: keeps has() and insert() O(1) however many rooms there are
  private roomIds = new Set<string>();

  public has(roomId: string) {
    return this.roomIds.has(roomId);
  }

  public query(conditions: Partial<IRoomCache>, sortOptions?: SortOptions) {
    const query = new Query<IRoomCache>(this.rooms, conditions);

    if (sortOptions) {
      query.sort(sortOptions);
    }

    return query.filter(conditions);
  }

  public cleanup(processId: string) {
    const cachedRooms = this.query({ processId });
    debugMatchMaking("removing stale rooms by processId %s (%s rooms found)", processId, cachedRooms.length);

    cachedRooms.forEach((room) => this.remove(room.roomId));
    return Promise.resolve();
  }

  public findOne(conditions: Partial<IRoomCache>, sortOptions?: SortOptions) {
    const query = new Query<IRoomCache>(this.rooms, conditions);

    if (sortOptions) {
      query.sort(sortOptions);
    }

    return query as unknown as Promise<IRoomCache>;
  }

  public async findByIds(roomIds: string[]): Promise<Map<string, IRoomCache>> {
    const result = new Map<string, IRoomCache>();
    if (roomIds.length === 0) { return result; }
    const wanted = new Set(roomIds);
    for (const room of this.rooms) {
      if (wanted.has(room.roomId)) { result.set(room.roomId, room); }
    }
    return result;
  }

  public update(room: IRoomCache, operations: Partial<{ $set: Partial<IRoomCache>, $inc: Partial<IRoomCache> }>) {
    if (operations.$set) {
      for (const field in operations.$set) {
        if (operations.$set.hasOwnProperty(field)) {
          room[field] = operations.$set[field];
        }
      }
    }

    if (operations.$inc) {
      for (const field in operations.$inc) {
        if (operations.$inc.hasOwnProperty(field)) {
          room[field] += operations.$inc[field];
        }
      }
    }

    return true;
  }

  public async insert(room: IRoomCache) {
    if (this.has(room.roomId)) { return false; }

    this.roomIds.add(room.roomId);
    this.rooms.push(room);
    return true;
  }

  public persist(room: IRoomCache, create: boolean = false) {
    if (!create) { return false; }

    this.roomIds.add(room.roomId);
    this.rooms.push(room);

    return true;
  }

  public remove(roomId: string) {
    const roomIndex = this.rooms.findIndex((room) => room.roomId === roomId);
    if (roomIndex !== -1) {
      this.rooms.splice(roomIndex, 1);
      this.roomIds.delete(roomId);
      return true;
    }
    return false;
  }

  public clear() {
    this.rooms = [];
    this.roomIds.clear();
  }

  public shutdown() {
  }
}

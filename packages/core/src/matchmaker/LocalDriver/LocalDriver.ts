import { debugMatchMaking } from '../../Debug.ts';
import type { IRoomCache, SortOptions, MatchMakerDriver } from '../driver.ts';
import { Query } from './Query.ts';

// re-export
export type { IRoomCache, SortOptions, MatchMakerDriver };

export class LocalDriver implements MatchMakerDriver {
  public rooms: IRoomCache[] = [];

  public has(roomId: string) {
    return this.rooms.some((room) => room.roomId === roomId);
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

  public persist(room: IRoomCache, create: boolean = false) {
    // if (this.rooms.indexOf(room) !== -1) {
    //   // already in the list
    //   return true;
    // }

    if (!create) { return false; }

    // add to the list
    this.rooms.push(room);

    return true;
  }

  public remove(roomId: string) {
    const roomIndex = this.rooms.findIndex((room) => room.roomId === roomId);
    if (roomIndex !== -1) {
      this.rooms.splice(roomIndex, 1);
      return true;
    }
    return false;
  }

  public clear() {
    this.rooms = [];
  }

  public shutdown() {
  }
}

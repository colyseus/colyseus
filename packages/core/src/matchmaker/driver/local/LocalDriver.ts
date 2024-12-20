import { debugMatchMaking } from '../../../Debug.js';
import { IRoomCache, SortOptions, RoomCache, MatchMakerDriver } from '../api.js';

// re-export
export type { IRoomCache, SortOptions, RoomCache, MatchMakerDriver };

import { Query } from './Query.js';
import { RoomData } from './RoomData.js';

export class LocalDriver implements MatchMakerDriver {
  public rooms: IRoomCache[] = [];

  public createInstance(initialValues: any = {}) {
    return new RoomData(initialValues, this.rooms);
  }

  public has(roomId: string) {
    return this.rooms.some((room) => room.roomId === roomId);
  }

  public query(conditions: Partial<IRoomCache>, sortOptions?: SortOptions) {
    const query = new Query<RoomCache>(this.rooms, conditions);

    if (sortOptions) {
      query.sort(sortOptions);
    }

    return query.filter(conditions);
  }

  public cleanup(processId: string) {
    const cachedRooms = this.query({ processId });
    debugMatchMaking("removing stale rooms by processId %s (%s rooms found)", processId, cachedRooms.length);

    cachedRooms.forEach((room) => room.remove());
    return Promise.resolve();
  }

  public findOne(conditions: Partial<IRoomCache>, sortOptions?: SortOptions) {
    const query = new Query<RoomCache>(this.rooms, conditions);

    if (sortOptions) {
      query.sort(sortOptions);
    }

    return query as unknown as Promise<RoomCache>;
  }

  public clear() {
    this.rooms = [];
  }

  public shutdown() {
  }
}

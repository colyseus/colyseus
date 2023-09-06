import { IRoomListingData, MatchMakerDriver, QueryHelpers, RoomListingData, SortOptions } from './interfaces';

// re-export
export { IRoomListingData, SortOptions, RoomListingData, QueryHelpers, MatchMakerDriver };

import { Query } from './Query';
import { RoomCache } from './RoomData';

export class LocalDriver implements MatchMakerDriver {
  public rooms: RoomCache[] = [];

  public createInstance(initialValues: any = {}) {
    return new RoomCache(initialValues, this.rooms);
  }

  public async find(conditions: Partial<IRoomListingData>) {
    return this.rooms.filter(((room) => {
      for (const field in conditions) {
        if (
          conditions.hasOwnProperty(field) &&
          room[field] !== conditions[field]
        ) {
          return false;
        }
      }
      return true;
    }));
  }

  public findOne(conditions: Partial<IRoomListingData>) {
    return new Query<RoomListingData>(this.rooms, conditions) as any as QueryHelpers<RoomListingData>;
  }

  public async clear() {
    this.rooms = [];
  }

  public async shutdown() {
    return Promise.resolve();
  }
}

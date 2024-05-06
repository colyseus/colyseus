import { logger } from "../../Logger";
import { FilterCallback, IRoomListingData, SortOptions, RoomListingData, QueryHelpers, MatchMakerDriver } from "./interfaces";

// re-export
export type { FilterCallback, IRoomListingData, SortOptions, RoomListingData, QueryHelpers, MatchMakerDriver };

import { Query } from './Query';
import { RoomCache } from './RoomData';

export class LocalDriver implements MatchMakerDriver {
  public rooms: RoomCache[] = [];

  public createInstance(initialValues: any = {}) {
    return new RoomCache(initialValues, this.rooms);
  }

  public has(roomId: string) {
    return this.rooms.some((room) => room.roomId === roomId);
  }

  public find(conditions: Partial<IRoomListingData>) {
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

  public cleanup(processId: string) {
    const cachedRooms = this.find({ processId });
    logger.debug("> Removing stale rooms by processId:", processId, `(${cachedRooms.length} rooms found)`);

    cachedRooms.forEach((room) => room.remove());
    return Promise.resolve();
  }

  // Ohki - Code Review Question: I mentioned in MatchMakter.ts, this could be an optional property or an update to IRoomListingData.
  public findOne(conditions: Partial<IRoomListingData>, filterMethod?: FilterCallback) {
    return new Query<RoomListingData>(this.rooms, conditions, filterMethod) as any as QueryHelpers<RoomListingData>;
  }

  public clear() {
    this.rooms = [];
  }

  public shutdown() {
  }
}

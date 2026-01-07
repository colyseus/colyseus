import type { SortOptions } from '@colyseus/core';

export class Query<T> {
  private readonly rooms: Promise<T[]>;
  private conditions: any;
  protected order: Map<string, 1 | -1> = new Map();

  constructor(rooms: Promise<T[]>, conditions) {
    this.conditions = conditions;
    this.rooms = rooms;
  }

  public sort(options: SortOptions) {
    this.order.clear();

    const fields = Object.entries(options);

    if (fields.length) {
      for (const [field, direction] of fields) {
        if (direction === 1 || direction === 'asc' || direction === 'ascending') {
          this.order.set(field, 1);

        } else {
          this.order.set(field, -1);
        }
      }
    }

    return this;
  }

  private filterRooms(rooms: T[]): T[] {
    const conditions = Object.entries(this.conditions);
    const withConditions = conditions.length > 0;

    return rooms.filter((room: any) => {
      if (withConditions) {
        for (let [field, value] of conditions) {
          // Check if field exists in room (IRoomCache base fields)
          if (room.hasOwnProperty(field)) {
            if (room[field] !== value) {
              return false;
            }
          } else if (room.metadata?.hasOwnProperty(field)) {
            // Check if field exists in metadata
            if (room.metadata[field] !== value) {
              return false;
            }
          } else {
            // Field doesn't exist in room or metadata
            return false;
          }
        }
      }
      return true;
    });
  }

  private sortRooms(rooms: T[]): T[] {
    if (this.order.size) {
      rooms.sort((room1: any, room2: any) => {
        for (const [field, direction] of this.order) {
          // Check if field exists in room or metadata
          const val1 = room1.hasOwnProperty(field) ? room1[field] : room1.metadata?.[field];
          const val2 = room2.hasOwnProperty(field) ? room2[field] : room2.metadata?.[field];

          if (direction === 1) {
            if (val1 > val2) return 1;
            if (val1 < val2) return -1;
          } else {
            if (val1 > val2) return -1;
            if (val1 < val2) return 1;
          }
        }
        return 0;
      });
    }
    return rooms;
  }

  public all(): Promise<T[]> {
    return this.rooms.then(rooms => {
      return this.sortRooms(this.filterRooms(rooms));
    });
  }

  public then(resolve, reject) {
    return this.rooms.then(rooms => {
      return this.sortRooms(this.filterRooms(rooms))[0];
    }).then(resolve, reject);
  }
}
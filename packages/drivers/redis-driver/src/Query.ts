import { QueryHelpers, SortOptions } from '@colyseus/core';
import { RoomData } from './RoomData';

export class Query<T> implements QueryHelpers<T> {
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


  public then(resolve, reject) {
    return this.rooms.then(rooms => {

      if (this.order.size) {
        rooms.sort((room1, room2) => {
          for (const [field, direction] of this.order) {
            if (direction === 1) {
              if (room1[field] > room2[field]) return 1;
              if (room1[field] < room2[field]) return -1;
            } else {
              if (room1[field] > room2[field]) return -1;
              if (room1[field] < room2[field]) return 1;
            }
          }
        });
      }

      let conditions = Object.entries(this.conditions);
      let withConditions = conditions.length > 0;

      return resolve(rooms.find((room) => {
        if (withConditions) {
          for (let [field, value] of conditions) {
            if (room[field] !== value) {
              return false;
            }
          }
        }

        return true;
      }));
    })
  }
}

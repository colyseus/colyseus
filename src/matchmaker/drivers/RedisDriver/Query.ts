import { QueryHelpers } from '../Driver';
import { SortOptions } from '../../RegisteredHandler';
import { RoomData } from './RoomData';

const DESC_RE = /^$(-1|desc|descending)/i;

export class Query<T> implements QueryHelpers<T> {
  private readonly rooms: Promise<RoomData[]>;
  private conditions: any;
  protected order: Map<string, 1 | -1> = new Map();

  constructor(rooms: Promise<RoomData[]>, conditions) {
    this.conditions = conditions;
    this.rooms = rooms;
  }

  public sort(options: SortOptions) {
    this.order.clear();

    const fields = Object.entries(options);

    if (fields.length) {
      for (let [field, direction] of fields) {
        if (DESC_RE.test(String(direction))) {
          this.order.set(field, -1);
        } else {
          this.order.set(field, 1);
        }
      }
    }

    return this;
  }

  public then(resolve: any, reject: (reason?: any) => void) {
    return this.rooms
      .then((rooms) => {
        if (this.order.size) {
          rooms.sort((room1, room2) => {
            for (let [field, dir] of this.order) {
              if (dir === 1) {
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

        return rooms.find((room) => {
          if (withConditions) {
            for (let [field, value] of conditions) {
              if (room[field] !== value) {
                return false;
              }
            }
          }

          return true;
        });
      })
      .then(resolve, reject) as any;
  }
}

import { SortOptions } from '../../RegisteredHandler';
import { QueryHelpers } from '../Driver';

export class Query<T> implements QueryHelpers<T> {
  private $rooms: T[];
  private conditions: any;

  constructor(rooms: any[], conditions) {
    this.$rooms = rooms.slice(0);
    this.conditions = conditions;
  }

  public sort(options: SortOptions) {
    this.$rooms = this.$rooms.sort((room1, room2) => {
      for (const field in options) {
        if (options.hasOwnProperty(field)) {
          const direction = options[field];
          const isAscending = (direction === 1 || direction === 'asc' || direction === 'ascending');

          if (isAscending) {
            if (room1[field] > room2[field]) { return 1; }
            if (room1[field] < room2[field]) { return -1; }

          } else {
            if (room1[field] > room2[field]) { return -1; }
            if (room1[field] < room2[field]) { return 1; }
          }
        }
      }
    });
  }

  public then(resolve, reject) {
    const result: any = this.$rooms.find(((room) => {
      for (const field in this.conditions) {
        if (
          this.conditions.hasOwnProperty(field) &&
          room[field] !== this.conditions[field]
        ) {
          return false;
        }
      }
      return true;
    }));
    return resolve(result);
  }
}

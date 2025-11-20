import type { IRoomCache, SortOptions } from '../driver.ts';

export class Query<T extends IRoomCache> {
  private $rooms: T[];
  private conditions: any;
  private sortOptions?: SortOptions;

  constructor(rooms: any[], conditions) {
    this.$rooms = rooms.slice(0);
    this.conditions = conditions;
  }

  public sort(options: SortOptions) {
    // Store sort options instead of sorting immediately
    // This allows filtering first, then sorting fewer items
    this.sortOptions = options;
    return this;
  }

  private applySort(rooms: T[]): T[] {
    if (!this.sortOptions) {
      return rooms;
    }

    return rooms.sort((room1: T, room2: T) => {
      for (const field in this.sortOptions) {
        const direction = this.sortOptions[field];
        if (room1.hasOwnProperty(field)) {
          /**
           * IRoomCache field
           */
          if (direction === 1 || direction === 'asc' || direction === 'ascending') {
            if (room1[field] > room2[field]) { return 1; }
            if (room1[field] < room2[field]) { return -1; }

          } else {
            if (room1[field] > room2[field]) { return -1; }
            if (room1[field] < room2[field]) { return 1; }
          }
        } else if (room1.metadata?.hasOwnProperty(field)) {
          /**
           * metadata field
           */
          if (direction === 1 || direction === 'asc' || direction === 'ascending') {
            if (room1.metadata[field] > room2.metadata[field]) { return 1; }
            if (room1.metadata[field] < room2.metadata[field]) { return -1; }
          } else {
            if (room1.metadata[field] > room2.metadata[field]) { return -1; }
            if (room1.metadata[field] < room2.metadata[field]) { return 1; }
          }
        }
      }
      return 0;
    });
  }

  private applyFilter(rooms: T[], conditions: any): T[] {
    return rooms.filter(((room) => {
      for (const field in conditions) {
        if (conditions.hasOwnProperty(field)) {
          // Check if field exists in room (IRoomCache base fields)
          if (room.hasOwnProperty(field)) {
            if (room[field] !== conditions[field]) {
              return false;
            }
          } else if (room.metadata?.hasOwnProperty(field)) {
            // Check if field exists in metadata
            if (room.metadata[field] !== conditions[field]) {
              return false;
            }
          } else {
            // Field doesn't exist in room or metadata
            return false;
          }
        }
      }
      return true;
    }));
  }

  public filter(conditions: any) {
    // Filter first to reduce the number of items to sort
    const filtered = this.applyFilter(this.$rooms, conditions);
    return this.applySort(filtered);
  }

  public then(resolve, reject) {
    // Filter first to reduce the number of items to sort
    const filtered = this.applyFilter(this.$rooms, this.conditions);
    const sorted = this.applySort(filtered);
    const result: any = sorted[0];
    return resolve(result);
  }
}

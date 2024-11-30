import { FilterCallback, QueryHelpers, SortOptions } from './interfaces';

export class Query<T> implements QueryHelpers<T> {
  private $rooms: T[];
  private conditions: any;
  private filterMethod: FilterCallback;

  constructor(rooms: any[], conditions, filterMethod?: FilterCallback) {
    this.$rooms = rooms.slice(0);
    this.conditions = conditions;
    this.filterMethod = filterMethod || null;
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
      if (this.filterMethod === null) {
        // If no filterMethod is provided, use default behavior.
        for (const field in this.conditions) {
          if (
            this.conditions.hasOwnProperty(field) &&
            room[field] !== this.conditions[field]
          ) {
            return false;
          }
        }
      } else if (
        room['locked'] !==  this.conditions['locked'] ||
        room['name'] !==  this.conditions['name'] ||
        room['private'] !==  this.conditions['private']
      ) {
        // A filterMethod was provided.
        // We manually filter for locked, name and private. 
        // If locked, name or private do not match, there is no reason to proceed.
        return false;
      } else {
        // A filterMethod is provided and lock, name and private tested valid. 
        // We send conditions and room feilds back to the callback method.
        const callbackResult = this.filterMethod(this.conditions, room);

        // Return false when callback returns type-matched false.
        if (callbackResult === false) { 
          return false; 
        }
      }
      return true;
    }));
    return resolve(result);
  }
}

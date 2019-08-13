import { EventEmitter } from 'events';
import { RoomConstructor } from './../Room';

export class RegisteredHandler extends EventEmitter {
  public klass: RoomConstructor;
  public options: any;
  public filterOptions: string[] = [];

  constructor(klass: RoomConstructor, options: any) {
    super();

    this.klass = klass;
    this.options = options;
  }

  filterBy(options: string[]) {
    this.filterOptions = options;
    return this;
  }

  getFilterOptions(options: any) {
    return this.filterOptions.reduce((prev, curr, i, arr) => {
      const field = arr[i];
      if (options[field]) {
        prev[field] = options[field]
      }
      return prev;
    }, {});
  }
}

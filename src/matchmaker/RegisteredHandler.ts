import { EventEmitter } from 'events';
import { RoomConstructor } from './../Room';
import { RoomCacheData } from './RoomCache';

export const INVALID_OPTION_KEYS: Array<keyof RoomCacheData> = [
  'clients',
  'locked',
  // 'maxClients', - maxClients can be useful as filter options
  'metadata',
  'name',
  'processId',
  'roomId',
];

export interface SortOptions { [fieldName: string]: 1 | -1 | 'asc' | 'desc' | 'ascending' | 'descending'; }

export class RegisteredHandler extends EventEmitter {
  public klass: RoomConstructor;
  public options: any;

  public filterOptions: string[] = [];
  public sortOptions?: SortOptions;

  constructor(klass: RoomConstructor, options: any) {
    super();

    this.klass = klass;
    this.options = options;
  }

  public filterBy(options: string[]) {
    this.filterOptions = options;
    return this;
  }

  public sortBy(options: SortOptions) {
    this.sortOptions = options;
    return this;
  }

  public getFilterOptions(options: any) {
    return this.filterOptions.reduce((prev, curr, i, arr) => {
      const field = arr[i];
      if (options[field]) {
        if (INVALID_OPTION_KEYS.indexOf(field as any) !== -1) {
          console.warn(`option "${field}" has internal usage and is going to be ignored.`);

        } else {
          prev[field] = options[field];
        }
      }
      return prev;
    }, {});
  }
}

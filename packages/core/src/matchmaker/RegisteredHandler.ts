import { EventEmitter } from 'events';

import { RoomConstructor } from './../Room';
import { RoomListingData } from './drivers/Driver';
import { updateLobby } from './Lobby';

export const INVALID_OPTION_KEYS: Array<keyof RoomListingData> = [
  'clients',
  'locked',
  'private',
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

    if (typeof(klass) !== 'function') {
      console.debug('You are likely not importing your room class correctly.');
      throw new Error(`class is expected but ${typeof(klass)} was provided.`);
    }

    this.klass = klass;
    this.options = options;
  }

  public enableRealtimeListing() {
    this.on('create', (room) => updateLobby(room));
    this.on('lock', (room) => updateLobby(room));
    this.on('unlock', (room) => updateLobby(room));
    this.on('join', (room) => updateLobby(room));
    this.on('leave', (room, _, willDispose) => {
      if (!willDispose) {
        updateLobby(room);
      }
    });
    this.on('dispose', (room) => updateLobby(room, true));
    return this;
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

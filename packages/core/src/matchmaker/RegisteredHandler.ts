import { IncomingMessage } from 'http';
import { EventEmitter } from 'events';
import { logger } from '../Logger.js';
import { RoomCache, SortOptions } from './driver/api.js';

import { Room } from './../Room.js';
import { updateLobby } from './Lobby.js';
import { Type } from '../utils/types.js';

export const INVALID_OPTION_KEYS: Array<keyof RoomCache> = [
  'clients',
  'locked',
  'private',
  // 'maxClients', - maxClients can be useful as filter options
  'metadata',
  'name',
  'processId',
  'roomId',
];

export type ValidateAuthTokenCallback = (token: string, request?: IncomingMessage) => Promise<any>;

export class RegisteredHandler extends EventEmitter {
  public filterOptions: string[] = [];
  public sortOptions?: SortOptions;

  constructor(
    public name: string,
    public klass: Type<Room>,
    public options: any
  ) {
    super();

    if (typeof(klass) !== 'function') {
      logger.debug('You are likely not importing your room class correctly.');
      throw new Error(`class is expected but ${typeof(klass)} was provided.`);
    }
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
    this.on('dispose', (room) => updateLobby(room, false));
    this.on('visibility-change', (room, isVisible) => updateLobby(room, isVisible));

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
      if (options.hasOwnProperty(field)) {
        if (INVALID_OPTION_KEYS.indexOf(field as any) !== -1) {
          logger.warn(`option "${field}" has internal usage and is going to be ignored.`);

        } else {
          prev[field] = options[field];
        }
      }
      return prev;
    }, {});
  }
}

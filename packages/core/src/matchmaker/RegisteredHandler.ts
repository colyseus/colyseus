import { EventEmitter } from 'events';
import { logger } from '../Logger.ts';
import { Room, type OnCreateOptions } from './../Room.ts';
import { updateLobby } from './Lobby.ts';

import type { IRoomCache, SortOptions, IRoomCacheFilterByKeys, IRoomCacheSortByKeys } from './driver/api.ts';
import type { Client } from '../Transport.ts';
import type { Type } from '../utils/types.ts';

export const INVALID_OPTION_KEYS: Array<keyof IRoomCache> = [
  'clients',
  'locked',
  'private',
  // 'maxClients', - maxClients can be useful as filter options
  'metadata',
  'name',
  'processId',
  'roomId',
];

/**
 * If `OnCreateOptions<RoomType>` returns an `any` type, we want to fallback to the FallbackKeys.
 */
type OnCreateOptionsWithFallback<RoomType extends Type<Room>, FallbackKeys extends string> = unknown extends OnCreateOptions<RoomType>
  ? FallbackKeys
  : keyof OnCreateOptions<RoomType> | FallbackKeys;

export interface RegisteredHandlerEvents<RoomType extends Type<Room> = any> {
  create: [room: InstanceType<RoomType>];
  lock: [room: InstanceType<RoomType>];
  unlock: [room: InstanceType<RoomType>];
  join: [room: InstanceType<RoomType>, client: Client];
  leave: [room: InstanceType<RoomType>, client: Client, willDispose: boolean];
  dispose: [room: InstanceType<RoomType>];
  'visibility-change': [room: InstanceType<RoomType>, isVisible: boolean];
}

export class RegisteredHandler<
  RoomType extends Type<Room> = any
> extends EventEmitter<RegisteredHandlerEvents<RoomType>> {
  '~room': RoomType;

  public klass: RoomType;
  public options: any;

  public name: string;
  public filterOptions: Array<keyof OnCreateOptions<RoomType> | IRoomCacheFilterByKeys> = [];
  public sortOptions?: SortOptions;

  constructor(klass: RoomType, options?: any) {
    super();

    this.klass = klass;
    this.options = options;

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

  public filterBy<T extends OnCreateOptionsWithFallback<RoomType, IRoomCacheFilterByKeys>>(
    options: T[]
  ) {
    this.filterOptions = options;
    return this;
  }

  public sortBy<T extends OnCreateOptionsWithFallback<RoomType, IRoomCacheSortByKeys>>(
    options: { [K in T]: SortOptions[string] }
  ): this {
    this.sortOptions = options as unknown as SortOptions;
    return this;
  }

  public getFilterOptions(options: any) {
    return this.filterOptions.reduce((prev, curr, i, arr) => {
      const field = arr[i];
      if (options.hasOwnProperty(field)) {
        if (INVALID_OPTION_KEYS.indexOf(field as any) !== -1) {
          logger.warn(`option "${String(field)}" has internal usage and is going to be ignored.`);

        } else {
          prev[String(field)] = options[field];
        }
      }
      return prev;
    }, {});
  }
}

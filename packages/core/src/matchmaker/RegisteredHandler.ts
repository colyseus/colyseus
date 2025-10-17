import { IncomingMessage } from 'http';
import { EventEmitter } from 'events';
import { logger } from '../Logger.ts';
import { Room } from './../Room.ts';
import { updateLobby } from './Lobby.ts';

import type { RoomCache, SortOptions } from './driver/api.ts';
import type { Client } from '../Transport.ts';
import type { Type } from '../utils/types.ts';

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
  public filterOptions: string[] = [];
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

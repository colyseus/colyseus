import { EventEmitter } from 'events';
import { logger } from '../Logger.ts';
import { Room } from './../Room.ts';
import { updateLobby } from './Lobby.ts';

import type { IRoomCache, SortOptions, IRoomCacheFilterByKeys, IRoomCacheSortByKeys, ExtractMetadata } from './driver.ts';
import type { Client } from '../Transport.ts';
import type { Type } from "../utils/Utils.ts";

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
 * Type for filterBy that supports both onCreate options and metadata fields
 */
type FilterByKeys<RoomType extends Room> =
  | IRoomCacheFilterByKeys
  | (ExtractMetadata<RoomType> extends object
      ? keyof ExtractMetadata<RoomType> & string
      : never)

/**
 * Type for sortBy that supports room cache fields and metadata fields
 */
type SortByKeys<RoomType extends Room> =
  | IRoomCacheSortByKeys
  | (ExtractMetadata<RoomType> extends object
      ? keyof ExtractMetadata<RoomType> & string
      : never);

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
  public filterOptions: Array<FilterByKeys<InstanceType<RoomType>>> = [];
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
    this.on('dispose', (room) => updateLobby(room, true));
    this.on('visibility-change', (room, isVisible) => updateLobby(room, isVisible));

    return this;
  }

  /**
   * Define which fields should be used for filtering rooms.
   * Supports both onCreate options and metadata fields using dot notation.
   *
   * @example
   * // Filter by IRoomCache fields
   * .filterBy(['maxClients'])
   *
   * @example
   * // Filter by metadata fields
   * .filterBy(['difficulty', 'metadata.region'])
   *
   * @example
   * // Mix both
   * .filterBy(['mode', 'difficulty', 'maxClients'])
   */
  public filterBy<T extends FilterByKeys<InstanceType<RoomType>>>(
    options: T[]
  ) {
    this.filterOptions = options;
    return this;
  }

  /**
   * Define how rooms should be sorted when querying.
   * Supports both room cache fields and metadata fields using dot notation.
   *
   * @example
   * // Sort by number of clients (descending)
   * .sortBy({ clients: -1 })
   *
   * @example
   * // Sort by metadata field
   * .sortBy({ 'metadata.rating': -1 })
   *
   * @example
   * // Multiple sort criteria
   * .sortBy({ 'metadata.skillLevel': 1, clients: -1 })
   */
  public sortBy<T extends SortByKeys<InstanceType<RoomType>>>(
    options: { [K in T]: SortOptions[string] }
  ): this {
    this.sortOptions = options as unknown as SortOptions;
    return this;
  }

  public getMetadataFromOptions(options: any) {
    const metadata = this.getFilterOptions(options);

    if (this.sortOptions) {
      for (const field in this.sortOptions) {
        if (field in options && !(field in metadata)) {
          metadata[field] = options[field];
        }
      }
    }

    return Object.keys(metadata).length > 0 ? { metadata } : {};
  }

  /**
   * Extract filter options from client options.
   */
  public getFilterOptions(options: any) {
    return this.filterOptions.reduce((prev, curr, i, arr) => {
      const field = String(arr[i]);

      // Handle regular (non-metadata) fields
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

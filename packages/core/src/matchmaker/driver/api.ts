import type { Room } from "@colyseus/core";
import type { Type } from "../../utils/Utils.ts";

/**
 * Sort options for room queries.
 */
export interface SortOptions {
  [fieldName: string]: 1 | -1 | 'asc' | 'desc' | 'ascending' | 'descending';
}

/**
 * Built-in room cache fields that can be used for sorting.
 */
export type IRoomCacheSortByKeys = 'clients' | 'maxClients' | 'createdAt';

/**
 * Built-in room cache fields that can be used for filtering.
 */
export type IRoomCacheFilterByKeys = 'clients' | 'maxClients' | 'processId';

/**
 * Extract metadata type from Room type
 */
export type ExtractMetadata<RoomType extends Room> =
  RoomType extends Room<infer M> ? M : any;

/**
 * Generates a unique lock ID based on filter options.
 */
export function getLockId(filterOptions: any) {
  return Object.keys(filterOptions).map((key) => `${key}:${filterOptions[key]}`).join("-");
}

/**
 * Initialize a room cache which contains CRUD operations for room listings.
 *
 * @internal
 * @param initialValues - Predefined room properties.
 * @returns RoomData - New room cache.
 */
export function initializeRoomCache(initialValues: Partial<IRoomCache> = {}): IRoomCache {
  return {
    clients: 0,
    maxClients: Infinity,
    locked: false,
    private: false,
    metadata: undefined,
    // name: '',
    // publicAddress: '',
    // processId: '',
    // roomId: '',
    createdAt: (initialValues && initialValues.createdAt) ? new Date(initialValues.createdAt) : new Date(),
    unlisted: false,
    ...initialValues,
  } as IRoomCache;
}

export interface IRoomCache<Metadata = any> {
  /**
   * Room name.
   */
  name: string;

  /**
   * Unique identifier for the room.
   */
  roomId: string;

  /**
   * Process id where the room is running.
   */
  processId: string;

  /**
   * Number of clients connected to this room.
   */
  clients: number;

  /**
   * Maximum number of clients allowed to join the room.
   */
  maxClients: number;

  /**
   * Indicates if the room is locked (i.e. join requests are rejected).
   */
  locked?: boolean;

  /**
   * Indicates if the room is private
   * Private rooms can't be joined via `join()` or `joinOrCreate()`.
   */
  private?: boolean;

  /**
   * Public address of the server.
   */
  publicAddress?: string;

  /**
   * Do not show this room in lobby listing.
   */
  unlisted?: boolean;

  /**
   * Metadata associated with the room.
   */
  metadata?: Metadata;

  /**
   * When the room was created.
   */
  createdAt?: Date;
}

export interface MatchMakerDriver {
  /**
   * Check if a room exists in room cache.
   *
   * @param roomId - The room id.
   *
   * @returns Promise<boolean> | boolean - A promise or a boolean value indicating if the room exists.
   */
  has(roomId: string): Promise<boolean> | boolean;

  /**
   * Query rooms in room cache for given conditions.
   *
   * @param conditions - Filtering conditions.
   *
   * @returns Promise<IRoomCache[]> | IRoomCache[] - A promise or an object contaning room metadata list.
   */
  query<T extends Room = any>(
    conditions: Partial<IRoomCache & ExtractMetadata<T>>,
    sortOptions?: SortOptions
  ): Promise<Array<IRoomCache<ExtractMetadata<T>>>> | Array<IRoomCache<ExtractMetadata<T>>>;

  /**
   * Clean up rooms in room cache by process id.
   * @param processId - The process id.
   */
  cleanup?(processId: string): Promise<void>;

  /**
   * Query for a room in room cache for given conditions.
   *
   * @param conditions - Filtering conditions.
   *
   * @returns `IRoomCache` - An object contaning filtered room metadata.
   */
  findOne<T extends Room = any>(
    conditions: Partial<IRoomCache & ExtractMetadata<T>>,
    sortOptions?: SortOptions
  ): Promise<IRoomCache<ExtractMetadata<T>>>;

  /**
   * Remove a room from room cache.
   *
   * @param roomId - The room id.
   */
  remove(roomId: string): Promise<boolean> | boolean;

  /**
   * Update a room in room cache.
   *
   * @param IRoomCache - The room to update.
   * @param operations - The operations to update the room.
   */
  update(
    room: IRoomCache,
    operations: Partial<{ $set: Partial<IRoomCache>, $inc: Partial<IRoomCache> }>
  ): Promise<boolean> | boolean;

  /**
   * Persist a room in room cache.
   *
   * @param room - The room to persist.
   * @param create - If true, create a new record. If false (default), update existing record.
   */
  persist(room: IRoomCache, create?: boolean): Promise<boolean> | boolean;

  /**
   * Empty the room cache. Used for testing purposes only.
   * @internal Do not call this method yourself.
   */
  clear(): void;

  /**
   * Boot the room cache medium (if available).
   */
  boot?(): Promise<void>;

  /**
   * Dispose the connection of the room cache medium.
   */
  shutdown(): void;
}

export interface SortOptions {
  [fieldName: string]: 1 | -1 | 'asc' | 'desc' | 'ascending' | 'descending';
}

export function getLockId(filterOptions: any) {
  return Object.keys(filterOptions).map((key) => `${key}:${filterOptions[key]}`).join("-");
}

export interface IRoomCache {
  /**
   * Unique identifier for the room.
   */
  roomId: string;

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
  locked: boolean;

  /**
   * Indicates if the room is private
   * Private rooms can't be joined via `join()` or `joinOrCreate()`.
   */
  private: boolean;

  /**
   * Room name.
   */
  name: string;

  /**
   * Public address of the server.
   */
  publicAddress?: string;

  /**
   * Process id where the room is running.
   */
  processId: string;

  /**
   * Do not show this room in lobby listing.
   */
  unlisted: boolean;

  /**
   * Metadata associated with the room.
   */
  metadata: any;

  /**
   * Additional custom properties
   */
  [property: string]: any;
}

export interface RoomCache<Metadata= any> extends IRoomCache {
  metadata: Metadata;

  updateOne(operations: any);
  save();
  remove();
}

export interface MatchMakerDriver {
  /**
   * Initialize a room cache which contains CRUD operations for room listings.
   *
   * @param initialValues - Predefined room properties.
   *
   * @returns RoomData - New room cache.
   */
  createInstance(initialValues: Partial<IRoomCache>): RoomCache;

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
  query(conditions: Partial<IRoomCache>, sortOptions?: SortOptions,): Promise<IRoomCache[]> | IRoomCache[];

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
  findOne(conditions: Partial<IRoomCache>, sortOptions?: SortOptions): Promise<RoomCache>;

  /**
   * Empty the room cache.
   */
  clear(): void;

  /**
   * Dispose the connection of the room cache medium.
   */
  shutdown(): void;

  // /**
  //  *
  //  */
  // lock(): void;

  // /**
  //  *
  //  */
  // releaseLock(): void;
}

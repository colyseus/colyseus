export interface SortOptions { [fieldName: string]: 1 | -1 | 'asc' | 'desc' | 'ascending' | 'descending'; }

export interface IRoomListingData {
  clients: number;
  locked: boolean;
  private: boolean;
  maxClients: number;
  metadata: any;
  name: string;
  publicAddress?: string;
  processId: string;
  roomId: string;
  unlisted: boolean;
  [property: string]: any;
}

export interface RoomListingData<Metadata= any> extends IRoomListingData {
  metadata: Metadata;

  updateOne(operations: any);
  save();
  remove();
}

export interface QueryHelpers<T> {
  then: Promise<T>['then'];
  sort(options: SortOptions);
}

export interface MatchMakerDriver {

  /**
   * Initialize a room cache which contains CRUD operations for room listings.
   *
   * @param initialValues - Predefined room properties.
   *
   * @returns RoomData - New room cache.
   */
  createInstance(initialValues: Partial<IRoomListingData>): RoomListingData;

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
   * @returns Promise<RoomListingData[]> | RoomListingData[] - A promise or an object contaning room metadata list.
   */
  find(
    conditions: Partial<IRoomListingData>,
    additionalProjectionFields?: any,
  ): Promise<RoomListingData[]> | RoomListingData[];

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
   * @returns `RoomListingData` - An object contaning filtered room metadata.
   */
  findOne(conditions: Partial<IRoomListingData>, filterMethod?: FilterCallback): QueryHelpers<RoomListingData>;

  /**
   * Empty the room cache.
   */
  clear(): void;

  /**
   * Dispose the connection of the room cache medium.
   */
  shutdown(): void;
}

// Ohki - Code review question: What is the correct location for shared types? 
export type FilterCallback = (clientOptions?: any, roomOptions?: any) => boolean | null;


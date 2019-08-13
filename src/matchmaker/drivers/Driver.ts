export interface RoomCacheData {
  clients: number;
  locked: boolean;
  maxClients: number;
  metadata: any;
  name: string;
  processId: string;
  roomId: string;

  updateOne(operations: any);
  save();
  remove();
}

export interface QueryHelpers<T> {
  sort(options: any);
  then: Promise<T>["then"];
}

export interface MatchMakerDriver {
  createInstance(initialValues: any): RoomCacheData;
  find(conditions: any): Promise<RoomCacheData[]> | RoomCacheData[];
  findOne(conditions: any): QueryHelpers<RoomCacheData>;
}
export interface SortOptions {
    [fieldName: string]: 1 | -1 | 'asc' | 'desc' | 'ascending' | 'descending';
}
export interface IRoomListingData {
    clients: number;
    locked: boolean;
    private: boolean;
    maxClients: number;
    metadata: any;
    name: string;
    processId: string;
    roomId: string;
    unlisted: boolean;
    [property: string]: any;
}
export interface RoomListingData<Metadata = any> extends IRoomListingData {
    metadata: Metadata;
    updateOne(operations: any): any;
    save(): any;
    remove(): any;
}
export interface QueryHelpers<T> {
    then: Promise<T>['then'];
    sort(options: SortOptions): any;
}
export interface MatchMakerDriver {
    createInstance(initialValues: any): RoomListingData;
    find(conditions: Partial<IRoomListingData>, additionalProjectionFields?: any): Promise<RoomListingData[]> | RoomListingData[];
    findOne(conditions: Partial<IRoomListingData>): QueryHelpers<RoomListingData>;
    clear(): void;
    shutdown(): void;
}

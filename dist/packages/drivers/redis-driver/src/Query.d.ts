import { QueryHelpers, SortOptions } from '@colyseus/core';
export declare class Query<T> implements QueryHelpers<T> {
    private readonly rooms;
    private conditions;
    protected order: Map<string, 1 | -1>;
    constructor(rooms: Promise<T[]>, conditions: any);
    sort(options: SortOptions): this;
    then(resolve: any, reject: any): Promise<any>;
}

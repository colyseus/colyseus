/// <reference types="node" />
import { EventEmitter } from 'events';
import { RoomListingData, SortOptions } from './driver/interfaces';
import { RoomConstructor } from './../Room';
export declare const INVALID_OPTION_KEYS: Array<keyof RoomListingData>;
export declare class RegisteredHandler extends EventEmitter {
    klass: RoomConstructor;
    options: any;
    filterOptions: string[];
    sortOptions?: SortOptions;
    constructor(klass: RoomConstructor, options: any);
    enableRealtimeListing(): this;
    filterBy(options: string[]): this;
    sortBy(options: SortOptions): this;
    getFilterOptions(options: any): {};
}

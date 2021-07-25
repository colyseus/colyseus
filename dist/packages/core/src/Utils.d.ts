export declare const REMOTE_ROOM_SHORT_TIMEOUT: number;
export declare function generateId(length?: number): string;
export declare function registerGracefulShutdown(callback: (err?: Error) => void): void;
export declare function retry<T = any>(cb: Function, maxRetries?: number, errorWhiteList?: any[], retries?: number): Promise<T>;
export declare class Deferred<T = any> {
    promise: Promise<T>;
    resolve: Function;
    reject: Function;
    constructor();
    then(func: (value: T) => any): any;
    catch(func: (value: any) => any): Promise<any>;
}
export declare function spliceOne(arr: any[], index: number): boolean;
export declare function merge(a: any, ...objs: any[]): any;

import { nanoid } from 'nanoid';
import { type RoomException, type RoomMethodName } from '../errors/RoomExceptions.ts';

import { debugAndPrintError, debugMatchMaking } from '../Debug.ts';

export type Type<T> = new (...args: any[]) => T;
export type MethodName<T> = string & {
  [K in keyof T]: T[K] extends (...args: any[]) => any ? K : never
}[keyof T];

/**
 * Utility type that extracts the return type of a method or the type of a property
 * from a given class/object type.
 *
 * - If the key is a method, returns the awaited return type of that method
 * - If the key is a property, returns the type of that property
 */
export type ExtractMethodOrPropertyType<
  TClass,
  TKey extends keyof TClass
> = TClass[TKey] extends (...args: any[]) => infer R
  ? Awaited<R>
  : TClass[TKey];

// remote room call timeouts
export const REMOTE_ROOM_SHORT_TIMEOUT = Number(process.env.COLYSEUS_PRESENCE_SHORT_TIMEOUT || 2000);
export const MAX_CONCURRENT_CREATE_ROOM_WAIT_TIME = Number(process.env.COLYSEUS_MAX_CONCURRENT_CREATE_ROOM_WAIT_TIME || 0.5);

export function generateId(length: number = 9) {
  return nanoid(length);
}

export function getBearerToken(authHeader: string) {
  return (authHeader && authHeader.startsWith("Bearer ") && authHeader.substring(7, authHeader.length)) || undefined;
}

// nodemon sends SIGUSR2 before reloading
// (https://github.com/remy/nodemon#controlling-shutdown-of-your-script)
//
const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGUSR2'];

export function registerGracefulShutdown(callback: (err?: Error) => void) {
  /**
   * Gracefully shutdown on uncaught errors
   */
  process.on('uncaughtException', (err) => {
    debugAndPrintError(err);
    callback(err);
  });

  signals.forEach((signal) =>
    process.once(signal, () => callback()));
}

export function retry<T = any>(
  cb: Function,
  maxRetries: number = 3,
  errorWhiteList: any[] = [],
  retries: number = 0,
) {
  return new Promise<T>((resolve, reject) => {
    cb()
      .then(resolve)
      .catch((e: any) => {
        if (
          errorWhiteList.indexOf(e.constructor) !== -1 &&
          retries++ < maxRetries
        ) {
          setTimeout(() => {
            debugMatchMaking("retrying due to error (error: %s, retries: %s, maxRetries: %s)", e.message, retries, maxRetries);
            retry<T>(cb, maxRetries, errorWhiteList, retries).
              then(resolve).
              catch((e2) => reject(e2));
          }, Math.floor(Math.random() * Math.pow(2, retries) * 400));

        } else {
          reject(e);
        }
      });
  });
}

export function spliceOne(arr: any[], index: number): boolean {
  // manually splice availableRooms array
  // http://jsperf.com/manual-splice
  if (index === -1 || index >= arr.length) {
    return false;
  }

  const len = arr.length - 1;
  for (let i = index; i < len; i++) {
    arr[i] = arr[i + 1];
  }

  arr.length = len;
  return true;
}

export class Deferred<T = any> {
  public promise: Promise<T>;

  public resolve: Function;
  public reject: Function;

  constructor(promise?: Promise<T>) {
    this.promise = promise ?? new Promise<T>((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
  }

  public then(onFulfilled?: (value: T) => any, onRejected?: (reason: any) => any) {
    return this.promise.then(onFulfilled, onRejected);
  }

  public catch(func: (value: any) => any) {
    return this.promise.catch(func);
  }

  static reject (reason?: any) {
    return new Deferred(Promise.reject(reason));
  }

  static resolve<T = any>(value?: T) {
    return new Deferred<T>(Promise.resolve(value));
  }

}

export function merge(a: any, ...objs: any[]): any {
  for (let i = 0, len = objs.length; i < len; i++) {
    const b = objs[i];
    for (const key in b) {
      if (b.hasOwnProperty(key)) {
        a[key] = b[key];
      }
    }
  }
  return a;
}

export function wrapTryCatch(
  method: Function,
  onError: (error: RoomException, methodName: RoomMethodName) => void,
  exceptionClass: Type<RoomException>,
  methodName: RoomMethodName,
  rethrow: boolean = false,
  ...additionalErrorArgs: any[]
) {
  return (...args: any[]) => {
    try {
      const result = method(...args);
      if (typeof (result?.catch) === "function") {
        return result.catch((e: Error) => {
          onError(new exceptionClass(e, e.message, ...args, ...additionalErrorArgs), methodName);
          if (rethrow) { throw e; }
        });
      }
      return result;
    } catch (e: any) {
      onError(new exceptionClass(e, e.message, ...args, ...additionalErrorArgs), methodName);
      if (rethrow) { throw e; }
    }
  };
}

/**
 * Dynamically import a module using either require() or import()
 * based on the current module system (CJS vs ESM).
 *
 * This avoids double-loading packages when running in mixed ESM/CJS environments.
 * Errors are silently caught - await the promise and handle errors at usage site.
 */
export function dynamicImport<T = any>(moduleName: string): Promise<T> {
  // __dirname exists in CJS but not in ESM
  if (
    typeof __dirname !== 'undefined' &&
    // @ts-ignore
    typeof (Bun) === 'undefined' // prevent bun from loading CJS modules
  ) {
    // CJS context - use require()
    try {
      return Promise.resolve(require(moduleName));
    } catch (e: any) {
      // If the error is not a MODULE_NOT_FOUND error, reject with the error.
      if (e.code !== 'MODULE_NOT_FOUND') {
        return Promise.reject(e);
      }
      return Promise.resolve(undefined);
    }
  } else {
    // ESM context - use import()
    const promise = import(moduleName);
    promise.catch(() => {}); // prevent unhandled rejection warnings
    return promise;
  }
}
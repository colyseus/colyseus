import nanoid from 'nanoid';

import { debugAndPrintError } from './Debug';

// remote room call timeouts
export const REMOTE_ROOM_SHORT_TIMEOUT = Number(process.env.COLYSEUS_PRESENCE_SHORT_TIMEOUT || 2000);

export function generateId(length: number = 9) {
  return nanoid(length);
}

//
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
      .catch((e) => {
        if (
          errorWhiteList.indexOf(e.constructor) !== -1 &&
          retries++ < maxRetries
        ) {
          setTimeout(() => {
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

export class Deferred<T= any> {
  public promise: Promise<T>;

  public resolve: Function;
  public reject: Function;

  constructor() {
    this.promise = new Promise<T>((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
  }

  public then(func: (value: T) => any) {
    return this.promise.then.apply(this.promise, arguments);
  }

  public catch(func: (value: any) => any) {
    return this.promise.catch(func);
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

export interface HashedArray<T> {
  [key: string]: T;
}

export class HybridArray<T> {
  public uniqueProperty: string;
  public hashedArray: HashedArray<T>;
  public array: T[];

  constructor(uniquePropertyName: string, elements?: T[]) {
    this.uniqueProperty = uniquePropertyName;
    this.hashedArray = {};
    this.array = [];
    if (elements) {
      this.array = this.array.concat(elements);
      for (const element of elements) {
        this.hashedArray[element[this.uniqueProperty]] = element;
      }
    }
  }

  public get length(): number {
    return this.array.length;
  }

  public add(element: T) {
    if (!this.hashedArray[element[this.uniqueProperty]]) {
      this.array.push(element);
      this.hashedArray[element[this.uniqueProperty]] = element;
    } else {
      console.error(`Element already exists for ${this.uniqueProperty}: '${element[this.uniqueProperty]}'.`);
    }
  }

  public at(index: number) {
    if (index >= this.array.length) {
      this.indexError(index);
    } else {
      return this.array[index];
    }
  }

  public forEach(fn) {
    for (let element of this.array) {
      fn(element);
    }
  }

  public get(key: string): T {
    return this.hashedArray[key];
  }

  public indexOf(element: T): number {
    return this.array.indexOf(element);
  }

  public map(callback) {
    const result = [];
    for (let index = 0; index < this.array.length; index++) {
      result.push(callback(this.array[index], index, this.array));
    }
    return result;
  }

  public removeByIndex(index: number) {
    if (index >= this.array.length) {
      this.indexError(index);
      return undefined;
    } else {
      const removable = this.spliceOne(index);
      delete this.hashedArray[removable[this.uniqueProperty]];
      return removable;
    }
  }

  public removeByKey(key: string): T {
    if (!this.hashedArray[key]) {
      this.invalidKeyError(key);
      return undefined;
    } else {
      const removable = this.spliceOne(this.indexOf(this.hashedArray[key]));
      delete this.hashedArray[key];
      return removable;
    }
  }

  public removeByObject(obj: T): T {
    if (this.hashedArray[obj[this.uniqueProperty]]) {
      return this.removeByKey(obj[this.uniqueProperty]);
    } else if (this.indexOf(obj) != -1) {
      return this.removeByIndex(this.indexOf(obj));
    } else {
      console.error("Invalid object has been provided!");
      return undefined;
    }
  }

  private indexError(index) {
    console.error(`Index out of range, index: ${index}`);
  }

  private invalidKeyError(key) {
    console.error(`No such element for property '${this.uniqueProperty}': '${key}'.`)
  }

  private spliceOne(index: number): T {
    // manually splice availableRooms array
    // http://jsperf.com/manual-splice
    if (index === -1 || index >= this.array.length) {
      this.indexError(index);
      return undefined;
    }
    const removable = this.array[index];
    const len = this.array.length - 1;
    for (let i = index; i < len; i++) {
      this.array[i] = this.array[i + 1];
    }
    this.array.length = len;
    return removable;
  }
}

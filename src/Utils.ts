import * as querystring from 'querystring';

import { debugError } from './Debug';

//
// nodemon sends SIGUSR2 before reloading
// (https://github.com/remy/nodemon#controlling-shutdown-of-your-script)
//
const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGUSR2'];

export function registerGracefulShutdown(callback) {
  const calledOnce = false;

  signals.forEach((signal) =>
    process.once(signal, () => callback(signal)));
}

export function retry(
  cb: Function,
  maxRetries: number = 3,
  retries: number = 0,
  errorWhiteList: any[] = [],
) {
  return new Promise((resolve, reject) => {
    cb()
      .then(resolve)
      .catch((e) => {
        if (
          errorWhiteList.indexOf(e.constructor) === -1 &&
          retries++ < maxRetries
        ) {
          retry(cb, maxRetries, retries, errorWhiteList).
            then(resolve).
            catch((e2) => reject(e2));

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

  public then(func: (value: any) => any) {
    return this.promise.then(func);
  }

  public catch(func: (value: any) => any) {
    return this.promise.catch(func);
  }

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

export function parseQueryString(query: string): any {
  const data = querystring.parse(query.substr(1));

  for (const k in data) {
    if (!Object.prototype.hasOwnProperty.call(data, k)) { continue; }

    let typedValue;

    try {
      typedValue = JSON.parse(data[k] as string);

    } catch (e) {
      typedValue = data[k];
    }

    data[k] = typedValue;
  }

  return data;
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

export function logError(err: Error): void {
  if (err) {
    debugError(`websocket error: ${err.message}\n${err.stack}`);
  }
}

import { debugErrors } from './Debug';

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

export class Deferred {
  public promise: Promise<any>;

  public reject: Function;
  public resolve: Function;

  constructor() {
    this.promise = new Promise((resolve, reject) => {
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
    debugErrors(`websocket error: ${err.message}\n${err.stack}`);
  }
}

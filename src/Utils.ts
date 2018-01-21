//
// nodemon sends SIGUSR2 before reloading
// (https://github.com/remy/nodemon#controlling-shutdown-of-your-script)
//
export function registerGracefulShutdown (callback) {
  let calledOnce = false;
  ['SIGINT', 'SIGTERM', 'SIGUSR2'].forEach(signal => {
    process.once(signal, () => callback(signal));
  });
}

export class Deferred {
  promise: Promise<any>;

  reject: Function;
  resolve: Function;

  constructor() {
    this.promise = new Promise((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
  }

  then (func: (value: any) => any) {
    return this.promise.then(func);
  }

  catch (func: (value: any) => any) {
    return this.promise.catch(func);
  }
}

export function spliceOne (arr: Array<any>, index: number): boolean {
  // manually splice availableRooms array
  // http://jsperf.com/manual-splice
  if (index === -1 || index >= arr.length) {
    return false;
  }

  for (var i = index, len = arr.length - 1; i < len; i++) {
    arr[i] = arr[i + 1];
  }

  arr.length = len;

  return true;
}

export function merge (a: any, ...objs: any[]): any {
  for (let i = 0, len = objs.length; i < len; i++) {
    let b = objs[i];
    for (let key in b) {
      if (b.hasOwnProperty(key)) {
        a[key] = b[key]
      }
    }
  }
  return a;
}

export function logError (err: Error): void {
  if (err) {
    console.log(err)
  }
}

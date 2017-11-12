
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


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

export function merge (a: any, b: any): any {
  for (var key in b) {
    if (b.hasOwnProperty(key)) {
      a[key] = b[key]
    }
  }
  return a;
}

export function logError (err: Error): void {
  if (err) {
    console.log(err)
  }
}

//
// TODO: there is possibly room for improvement on this method
//
// You can see the impact of changes on this benchmark:
// `node --harmony test/benchmark/patch.js`
//
export function toJSON (obj: any): any {
  let result

  if (obj && typeof(obj.toJSON)==="function") {
    result = obj.toJSON()

  } else if (obj instanceof Array) {
    result = obj.map((_) => toJSON(_))

  } else {
    result = obj;
  }

  if (result && typeof(result)==="object") {
    let copy = Array.isArray(result) ? [] : {};

    for (var k in result) {
      if (typeof(result[k]) !== "function") {
        copy[k] = toJSON(result[k]);
      }
    }

    result = copy;
  }

  return result
}

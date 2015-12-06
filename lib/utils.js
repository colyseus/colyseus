module.exports.spliceOne = function(arr, index) {
  // manually splice availableRooms array
  // http://jsperf.com/manual-splice
  if (index >= arr.length) {
    return;
  }
  for (var i = index, len = arr.length - 1; i < len; i++) {
    arr[i] = arr[i + 1];
  }
  arr.length = len;
}

module.exports.merge = function (a, b) {
  for (var key in b) {
    if (b.hasOwnProperty(key)) {
      a[key] = b[key]
    }
  }
  return a;
}

module.exports.logError = function(err) {
  if (err) {
    console.log(err)
  }
}

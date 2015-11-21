module.exports.splice = function(arr, index) {
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

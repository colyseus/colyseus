"use strict";

const logger = require("./logger.js")
const crypto = require("crypto");

exports.GetUTCTimestamp = function() {
    var now = new Date();
    var utc_timestamp = Date.UTC(now.getUTCFullYear(),now.getUTCMonth(), now.getUTCDate() , 
      now.getUTCHours(), now.getUTCMinutes(), now.getUTCSeconds(), now.getUTCMilliseconds());
    return utc_timestamp;
}

exports.GetUTCTimestampFromDate = function(now) {
  var utc_timestamp = Date.UTC(now.getUTCFullYear(),now.getUTCMonth(), now.getUTCDate() , 
    now.getUTCHours(), now.getUTCMinutes(), now.getUTCSeconds(), now.getUTCMilliseconds());
  return utc_timestamp;
}

exports.GetUTCISO = function() {
    var now = new Date();
    return now.toISOString();
}

exports.isValidMd5 = function(md5 ='') {
  return md5.matches("^[a-fA-F0-9]{32}$");
}


exports.GetUTCDate = function() {
    var now = new Date();
    var utc_timestamp = Date.UTC(now.getUTCFullYear(),now.getUTCMonth(), now.getUTCDate() , 
      now.getUTCHours(), now.getUTCMinutes(), now.getUTCSeconds(), now.getUTCMilliseconds());
    return new Date(utc_timestamp);
}

let ConvertToCSCGrid = exports.ConvertToCSCGrid =  function(number){
  return Math.floor(number/5000); // 5000 unity grid size
}

exports.RoundTo =  function(number, roundto){
  return roundto * Math.round(number/roundto);
}

// exports.InsidePolyGone = function(point, polyVectorsArray) {
//   // ray-casting algorithm based on
//   // http://www.ecse.rpi.edu/Homepages/wrf/Research/Short_Notes/pnpoly.html

//   var x = point[0], y = point[1];

//   var inside = false;
//   for (var i = 0, j = vs.length - 1; i < vs.length; j = i++) {
//       var xi = vs[i][0], yi = vs[i][1];
//       var xj = vs[j][0], yj = vs[j][1];

//       var intersect = ((yi > y) != (yj > y))
//           && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
//       if (intersect) inside = !inside;
//   }

//   return inside;
// };

exports.DistanceBetweenLocArrays = function(loc, loc2) {
  if(loc.length < 2 || loc2.length < 2 || Array.isArray(loc2) == false || Array.isArray(loc) == false) {
    logger.error("Invaild Location Arrays for Distance Check");
    return 9999999999;
  }
  let dist = Math.sqrt( Math.pow((parseFloat(loc[0])-parseFloat(loc2[0])), 2) + Math.pow((parseFloat(loc[1])-parseFloat(loc2[1])), 2) );

  return dist;
}

exports.DistanceBetweenLoc3DArrays = function(loc, loc2) {
  if(loc.length < 2 || loc2.length < 2 || Array.isArray(loc2) == false || Array.isArray(loc) == false) {
    logger.error("Invaild Location Arrays for Distance Check");
    return 9999999999;
  }
  let dist = Math.sqrt( Math.pow((parseFloat(loc[0])-parseFloat(loc2[0])), 2) + Math.pow((parseFloat(loc[2])-parseFloat(loc2[2])), 2) );

  return dist;
}

// We'll just use guard clauses here.
exports.isNumber = function (value) {
  // We will not coerce boolean to numbers, although we could.
  // We will not coerce strings to numbers, even though we could try.
  // Referencing https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/typeof
  if (typeof value !== 'number') {
    return false
  }

  if(isNaN(value)) {
    return false;
  }

  // Consider this as the NaN check.
  // NaN is a number.
  // NaN has the unique property of never equaling itself.
  // Pulled this hack right off of MDN: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/isNaN
  if (value !== Number(value)) {
    return false
  }
  
  // At this point, we for sure have some sort of number.
  // But not all numbers are finite, and realistically we want finite numbers.
  if (Number.isFinite(value) === false) {
    return false
  }

  return true
}


exports.getRandomIntInclusive =  function(min, max) {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min + 1)) + min; //The maximum is inclusive and the minimum is inclusive 
}

exports.getRandomFloatInclusive =  function(min, max) {
  min = parseFloat(min);
  max = parseFloat(max);
  return parseFloat(Math.random() * (max - min + 1)) + min; //The maximum is inclusive and the minimum is inclusive 
}

exports.shuffle = function(array) {
  for (var i = array.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var temp = array[i];
      array[i] = array[j];
      array[j] = temp;
  }

  return array;
}

exports.convertToDaysHoursSecondsStringFormat = function(seconds) {
  let totalSecondsLeft = seconds;
  let displayTime = '';

  let days = Math.floor(totalSecondsLeft / (3600.0 * 24.0));
  if(days >= 1) {
      displayTime += days.toString() + "D ";
      totalSecondsLeft -= (days * 3600 * 24);
  }

  let hours = Math.floor(totalSecondsLeft / 3600.0);
  if(hours > 0) {
      displayTime += hours.toString() + "H ";
      totalSecondsLeft -= hours * 3600;
  }

  let minutes = Math.floor(totalSecondsLeft / 60.0);
  if(minutes > 0) {
      displayTime += minutes.toString() + "M ";
      totalSecondsLeft -= minutes * 60;
  }

  totalSecondsLeft = Math.floor(totalSecondsLeft);
  if(totalSecondsLeft > 0) {
      displayTime += totalSecondsLeft.toString() + "S";
  }

  return displayTime;
}

var lut = []; for (var i=0; i<256; i++) { lut[i] = (i<16?'0':'')+(i).toString(16); }
var genUID = exports.genNewUID = function () {
    var d0 = Math.random()*0xffffffff|0;
    var d1 = Math.random()*0xffffffff|0;
    var d2 = Math.random()*0xffffffff|0;
    var d3 = Math.random()*0xffffffff|0;
    return lut[d0&0xff]+lut[d0>>8&0xff]+lut[d0>>16&0xff]+lut[d0>>24&0xff]+
        lut[d1&0xff]+lut[d1>>8&0xff]+lut[d1>>16&0x0f|0x40]+
        lut[d2&0x3f|0x80]+lut[d2>>8&0xff]+lut[d3&0xff]+lut[d3>>8&0xff];
}

let genLargeUID = exports.genLargeUID = function ()
{
  var d0 = Math.random()*0xffffffff|0;
  var d1 = Math.random()*0xffffffff|0;
  var d2 = Math.random()*0xffffffff|0;
  var d3 = Math.random()*0xffffffff|0;
  return lut[d0&0xff]+lut[d0>>8&0xff]+lut[d0>>16&0xff]+lut[d0>>24&0xff]+
    lut[d1&0xff]+lut[d1>>8&0xff]+lut[d1>>16&0x0f|0x40]+lut[d1>>24&0xff]+
    lut[d2&0x3f|0x80]+lut[d2>>8&0xff]+lut[d2>>16&0xff]+lut[d2>>24&0xff]+
    lut[d3&0xff]+lut[d3>>8&0xff]+lut[d3>>16&0xff]+lut[d3>>24&0xff];
}

exports.createMD5Hash = (input) => {
  try {
    let md5Hash = crypto.createHash("md5").update(input).digest('hex');
    return md5Hash;
  } catch (error) {
    logger.error(error);
    return null;
  }
}

exports.clamp = function(value, min, max) {
  return Math.min(Math.max(value, min), max);
};

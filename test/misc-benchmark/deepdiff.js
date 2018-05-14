"use strict";

console.log('benchmark: deep diff')

var Benchmark = require('benchmark')
  , fossilDelta = require('fossil-delta')
  , msgpack = require('notepack.io')
  , toJSON = require('../../lib/Utils').toJSON
  , generateId = require('../../lib').generateId
  , suite = new Benchmark.Suite()
  // , deepEql = require('deep-eql')
  , deepEqual = require('deep-equal');

var obj1Equal = {
  players: {
    '1': { x: 44.4444, y: 55.5555, radius: 0.12312313, name: "Player X" },
    '2': { x: 22, y: 10, radius: Math.PI, name: "Player Y" },
    // '3': { x: 44.4444, y: 55.5555, radius: 0.12312313, name: "Player X" },
    // '4': { x: 44.4444, y: 55.5555, radius: 0.12312313, name: "Player X" },
    // '5': { x: 44.4444, y: 55.5555, radius: 0.12312313, name: "Player X" },
    // '6': { x: 44.4444, y: 55.5555, radius: 0.12312313, name: "Player X" },
    // '7': { x: 44.4444, y: 55.5555, radius: 0.12312313, name: "Player X" },
    // '8': { x: 44.4444, y: 55.5555, radius: 0.12312313, name: "Player X" },
    // '9': { x: 44.4444, y: 55.5555, radius: 0.12312313, name: "Player X" },
    // '10': { x: 44.4444, y: 55.5555, radius: 0.12312313, name: "Player X" },
    // '11': { x: 44.4444, y: 55.5555, radius: 0.12312313, name: "Player X" },
    // '12': { x: 44.4444, y: 55.5555, radius: 0.12312313, name: "Player X" },
    // '13': { x: 44.4444, y: 55.5555, radius: 0.12312313, name: "Player X" },
    // '14': { x: 44.4444, y: 55.5555, radius: 0.12312313, name: "Player X" },
    // '15': { x: 44.4444, y: 55.5555, radius: 0.12312313, name: "Player X" },
    // '16': { x: 44.4444, y: 55.5555, radius: 0.12312313, name: "Player X" },
    // '17': { x: 44.4444, y: 55.5555, radius: 0.12312313, name: "Player X" },
    // '18': { x: 44.4444, y: 55.5555, radius: 0.12312313, name: "Player X" },
    // '19': { x: 44.4444, y: 55.5555, radius: 0.12312313, name: "Player X" },
    // '20': { x: 44.4444, y: 55.5555, radius: 0.12312313, name: "Player X" },
    // '21': { x: 44.4444, y: 55.5555, radius: 0.12312313, name: "Player X" },
    // '22': { x: 44.4444, y: 55.5555, radius: 0.12312313, name: "Player X" },
    // '23': { x: 44.4444, y: 55.5555, radius: 0.12312313, name: "Player X" },
    // '24': { x: 44.4444, y: 55.5555, radius: 0.12312313, name: "Player X" },
    // '25': { x: 44.4444, y: 55.5555, radius: 0.12312313, name: "Player X" },
  },
  messages: [ "One", "Two", "Three" ]
}

var obj2Equal = {
  players: {
    '1': { x: 44.4444, y: 55.5555, radius: 0.12312313, name: "Player X" },
    '2': { x: 22, y: 10, radius: Math.PI, name: "Player Y" },
    // '3': { x: 44.4444, y: 55.5555, radius: 0.12312313, name: "Player X" },
    // '4': { x: 44.4444, y: 55.5555, radius: 0.12312313, name: "Player X" },
    // '5': { x: 44.4444, y: 55.5555, radius: 0.12312313, name: "Player X" },
    // '6': { x: 44.4444, y: 55.5555, radius: 0.12312313, name: "Player X" },
    // '7': { x: 44.4444, y: 55.5555, radius: 0.12312313, name: "Player X" },
    // '8': { x: 44.4444, y: 55.5555, radius: 0.12312313, name: "Player X" },
    // '9': { x: 44.4444, y: 55.5555, radius: 0.12312313, name: "Player X" },
    // '10': { x: 44.4444, y: 55.5555, radius: 0.12312313, name: "Player X" },
    // '11': { x: 44.4444, y: 55.5555, radius: 0.12312313, name: "Player X" },
    // '12': { x: 44.4444, y: 55.5555, radius: 0.12312313, name: "Player X" },
    // '13': { x: 44.4444, y: 55.5555, radius: 0.12312313, name: "Player X" },
    // '14': { x: 44.4444, y: 55.5555, radius: 0.12312313, name: "Player X" },
    // '15': { x: 44.4444, y: 55.5555, radius: 0.12312313, name: "Player X" },
    // '16': { x: 44.4444, y: 55.5555, radius: 0.12312313, name: "Player X" },
    // '17': { x: 44.4444, y: 55.5555, radius: 0.12312313, name: "Player X" },
    // '18': { x: 44.4444, y: 55.5555, radius: 0.12312313, name: "Player X" },
    // '19': { x: 44.4444, y: 55.5555, radius: 0.12312313, name: "Player X" },
    // '20': { x: 44.4444, y: 55.5555, radius: 0.12312313, name: "Player X" },
    // '21': { x: 44.4444, y: 55.5555, radius: 0.12312313, name: "Player X" },
    // '22': { x: 44.4444, y: 55.5555, radius: 0.12312313, name: "Player X" },
    // '23': { x: 44.4444, y: 55.5555, radius: 0.12312313, name: "Player X" },
    // '24': { x: 44.4444, y: 55.5555, radius: 0.12312313, name: "Player X" },
    // '25': { x: 44.4444, y: 55.5555, radius: 0.12312313, name: "Player X" },
  },
  messages: [ "One", "Two", "Three" ]
}

var obj1Differ = {
  players: {
    // '3': { x: 44.4444, y: 55.5555, radius: 0.12312313, name: "Player X" },
    // '4': { x: 44.4444, y: 55.5555, radius: 0.12312313, name: "Player X" },
    // '5': { x: 44.4444, y: 55.5555, radius: 0.12312313, name: "Player X" },
    // '6': { x: 44.4444, y: 55.5555, radius: 0.12312313, name: "Player X" },
    // '7': { x: 44.4444, y: 55.5555, radius: 0.12312313, name: "Player X" },
    // '8': { x: 44.4444, y: 55.5555, radius: 0.12312313, name: "Player X" },
    // '9': { x: 44.4444, y: 55.5555, radius: 0.12312313, name: "Player X" },
    // '10': { x: 44.4444, y: 55.5555, radius: 0.12312313, name: "Player X" },
    // '11': { x: 44.4444, y: 55.5555, radius: 0.12312313, name: "Player X" },
    // '12': { x: 44.4444, y: 55.5555, radius: 0.12312313, name: "Player X" },
    // '13': { x: 44.4444, y: 55.5555, radius: 0.12312313, name: "Player X" },
    // '14': { x: 44.4444, y: 55.5555, radius: 0.12312313, name: "Player X" },
    // '15': { x: 44.4444, y: 55.5555, radius: 0.12312313, name: "Player X" },
    // '16': { x: 44.4444, y: 55.5555, radius: 0.12312313, name: "Player X" },
    // '17': { x: 44.4444, y: 55.5555, radius: 0.12312313, name: "Player X" },
    // '18': { x: 44.4444, y: 55.5555, radius: 0.12312313, name: "Player X" },
    // '19': { x: 44.4444, y: 55.5555, radius: 0.12312313, name: "Player X" },
    // '20': { x: 44.4444, y: 55.5555, radius: 0.12312313, name: "Player X" },
    // '21': { x: 44.4444, y: 55.5555, radius: 0.12312313, name: "Player X" },
    // '22': { x: 44.4444, y: 55.5555, radius: 0.12312313, name: "Player X" },
    // '23': { x: 44.4444, y: 55.5555, radius: 0.12312313, name: "Player X" },
    // '24': { x: 44.4444, y: 55.5555, radius: 0.12312313, name: "Player X" },
    // '25': { x: 44.4444, y: 55.5555, radius: 0.12312313, name: "Player X" },
    '1': { x: 44.4444, y: 55.5555, radius: 0.12312313, name: "Player X" },
    '2': { x: 22, y: 10, radius: Math.PI, name: "Player Y" },
  },
  messages: [ "One", "Two", "Three" ]
}

var obj2Differ = {
  players: {
    // '3': { x: 44.4444, y: 55.5555, radius: 0.12312313, name: "Player X" },
    // '4': { x: 44.4444, y: 55.5555, radius: 0.12312313, name: "Player X" },
    // '5': { x: 44.4444, y: 55.5555, radius: 0.12312313, name: "Player X" },
    // '6': { x: 44.4444, y: 55.5555, radius: 0.12312313, name: "Player X" },
    // '7': { x: 44.4444, y: 55.5555, radius: 0.12312313, name: "Player X" },
    // '8': { x: 44.4444, y: 55.5555, radius: 0.12312313, name: "Player X" },
    // '9': { x: 44.4444, y: 55.5555, radius: 0.12312313, name: "Player X" },
    // '10': { x: 44.4444, y: 55.5555, radius: 0.12312313, name: "Player X" },
    // '11': { x: 44.4444, y: 55.5555, radius: 0.12312313, name: "Player X" },
    // '12': { x: 44.4444, y: 55.5555, radius: 0.12312313, name: "Player X" },
    // '13': { x: 44.4444, y: 55.5555, radius: 0.12312313, name: "Player X" },
    // '14': { x: 44.4444, y: 55.5555, radius: 0.12312313, name: "Player X" },
    // '15': { x: 44.4444, y: 55.5555, radius: 0.12312313, name: "Player X" },
    // '16': { x: 44.4444, y: 55.5555, radius: 0.12312313, name: "Player X" },
    // '17': { x: 44.4444, y: 55.5555, radius: 0.12312313, name: "Player X" },
    // '18': { x: 44.4444, y: 55.5555, radius: 0.12312313, name: "Player X" },
    // '19': { x: 44.4444, y: 55.5555, radius: 0.12312313, name: "Player X" },
    // '20': { x: 44.4444, y: 55.5555, radius: 0.12312313, name: "Player X" },
    // '21': { x: 44.4444, y: 55.5555, radius: 0.12312313, name: "Player X" },
    // '22': { x: 44.4444, y: 55.5555, radius: 0.12312313, name: "Player X" },
    // '23': { x: 44.4444, y: 55.5555, radius: 0.12312313, name: "Player X" },
    // '24': { x: 44.4444, y: 55.5555, radius: 0.12312313, name: "Player X" },
    // '25': { x: 44.4444, y: 55.5555, radius: 0.12312313, name: "Player X" },
    '1': { x: 44.4444, y: 55.5555, radius: 0.12312313, name: "Player X" },
    '2': { x: 22, y: 20, radius: Math.PI, name: "Player Y" },
  },
  messages: [ "One", "Two", "Three" ]
}

suite.add('compare EQUAL using deep-equal', function() {
  if (!deepEqual(obj1Equal, JSON.parse(JSON.stringify(obj2Equal)))) {
    throw new Error("oops");
  }
});

suite.add('compare DIFFER using deep-equal', function() {
  if (deepEqual(obj1Differ, JSON.parse(JSON.stringify(obj2Differ)))) {
    throw new Error("oops");
  }
});

var eq1 = toJSON(obj1Equal);
var eq2 = toJSON(obj2Equal);
suite.add('compare EQUAL before binary serialize', function() {
  if (JSON.stringify(eq1) !== JSON.stringify(eq2)) {
    throw new Error("oops");
  }
});

var diff1 = toJSON(obj1Differ);
var diff2 = toJSON(obj2Differ);
suite.add('compare DIFFER before binary serialize', function() {
  if (JSON.stringify(diff1) === JSON.stringify(diff2)) {
    throw new Error("oops");
  }
});

var eq11 = toJSON(obj1Equal);
var eq22 = toJSON(obj2Equal);

suite.add('compare EQUAL after binary serialize', function() {
  if (!msgpack.encode(eq11).equals(msgpack.encode(eq22))) {
    throw new Error("oops");
  }
});

var diff11 = toJSON(obj1Differ);
var diff22 = toJSON(obj2Differ);
suite.add('compare DIFFER after binary serialize', function() {
  if (msgpack.encode(diff11).equals(msgpack.encode(diff22))) {
    throw new Error("oops");
  }
});


suite.on('cycle', function(event) {
  console.log(String(event.target));
})

suite.run()

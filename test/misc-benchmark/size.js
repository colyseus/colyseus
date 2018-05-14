"use strict";

console.log('benchmark: evaluating a complex patch state')

var Benchmark = require('benchmark')
  , fossilDelta = require('fossil-delta')
  , nodeDelta = require('node-delta')
  , msgpack = require('notepack.io')
  , toJSON = require('../../lib/Utils').toJSON
  , generateId = require('../../lib').generateId
  , suite = new Benchmark.Suite()

var deepObject = { entities: {} };
var wave = 1;
var numPlayers = 2;

for (var i = 0, len = 100; i < len; i++) {
  deepObject.entities[ generateId() ] = { x: Math.random(), y: Math.random() };
}

var deepObject2 = {entities: {}};
for (var id in deepObject.entities) {
  deepObject2.entities[id] = { x: Math.random(), y: Math.random() };
}

console.log(deepObject)
console.log(deepObject2)

suite.add('fossil-delta', function() {
  fossilDelta.create(msgpack.encode(deepObject), msgpack.encode(deepObject2))
});

suite.add('node-delta', function() {
  nodeDelta.create(msgpack.encode(deepObject), msgpack.encode(deepObject2))
});

suite.on('cycle', function(event) {
  console.log(String(event.target));
});

suite.run();

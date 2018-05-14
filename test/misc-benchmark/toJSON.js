"use strict";

console.log('benchmark: toJSON');

var Benchmark = require('benchmark')
  , toJSON = require('../../lib/Utils').toJSON
  , suite = new Benchmark.Suite()

var obj = {
  players: {
    '1': { x: 44.4444, y: 55.5555, radius: 0.12312313, name: "Player X" },
    '2': { x: 22, y: 10, radius: Math.PI, name: "Player Y" },
  },
  messages: [ "One", "Two", "Three" ]
}

suite.add('toJSON', function() {
  toJSON(obj);
});

suite.add('JSON.stringify', function() {
  JSON.stringify(obj);
});


suite.on('cycle', function(event) {
  console.log(String(event.target));
})

suite.run()

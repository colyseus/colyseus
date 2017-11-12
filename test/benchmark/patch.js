"use strict";

console.log('benchmark: evaluating a complex patch state')

var Benchmark = require('benchmark')
  , jsonpatch = require('fast-json-patch')
  , fossilDelta = require('fossil-delta')
  , msgpack = require('notepack.io')
  , toJSON = require('../../lib/Utils').toJSON

  , suite = new Benchmark.Suite()

class PlainState {
  constructor () {
    this.integer = 1;
    this.float = Math.PI
    this.string = "Hello world"
    this.array = [1,2,3,4,5,6,7,8,9,10]
    this.objs = [{hp: 100, x: 0, y: 0}, {hp: 80, x: 10, y: 20}, {hp: 25, x: 8, y: -14}]
    this.boolean = true
    this.null = null
    this.teams = [
      { id: 0, score: 0 },
      { id: 1, score: 0 },
      { id: 2, score: 0 },
      { id: 3, score: 0 }
    ]
  }
}

class ChildObject {
  constructor (hp, x, y, parent) {
    this.complexObject = global
    this.parent = parent
    this.hp = hp
    this.x = x
    this.y = y
  }
  toJSON () {
    return { hp: this.hp, x: this.x, y: this.y }
  }
}

class ComplexState {
  constructor () {
    this.complexObject = global
    this.integer = 1;
    this.float = Math.PI
    this.string = "Hello world"
    this.array = [1,2,3,4,5,6,7,8,9,10]
    this.objs = [
      new ChildObject(100, 0, 0, this),
      new ChildObject(80, 10, 20, this),
      new ChildObject(25, 8, -14, this)
    ]
    this.boolean = true
    this.null = null
    this.teams = [
      { id: 0, score: 0 },
      { id: 1, score: 0 },
      { id: 2, score: 0 },
      { id: 3, score: 0 }
    ]
  }
  add(hp, x, y) {
    this.objs.push( new ChildObject(hp, x, y, this) )
  }
  toJSON () {
    return {
      integer: this.integer,
      float: this.float,
      string: this.string,
      array: this.array,
      objs: this.objs,
      boolean: this.boolean,
      null: this.null,
      teams: this.teams
    }
  }
}

var obj2 = new ComplexState();
var state2 = JSON.parse(JSON.stringify(toJSON(obj2)))
suite.add('using json', function() {
  for (var i=0; i<4; i++) {
    obj2.objs[0].hp--;
    obj2.objs[2].hp--;
    obj2.teams[i].score++;
    var newState = JSON.parse(JSON.stringify(toJSON(obj2)))
    var diff = msgpack.encode( jsonpatch.compare(state2, newState) )
    state2 = newState
  }
})

var obj3 = new PlainState();
var observer = jsonpatch.observe(obj3)
suite.add('using plain + observe', function() {
  for (var i=0; i<4; i++) {
    obj3.objs[0].hp--;
    obj3.objs[2].hp--;
    obj3.teams[i].score++;
    var diff = msgpack.encode( jsonpatch.generate(observer) )
  }
})

var obj4 = new ComplexState();
var obj4state = JSON.parse(JSON.stringify(toJSON(obj4)))
var observer2 = jsonpatch.observe(obj4state)
suite.add('using complex + observe', function() {
  for (var i=0; i<4; i++) {
    obj4.objs[0].hp--;
    obj4.objs[2].hp--;
    obj4.teams[i].score++;
    Object.assign(obj4state, toJSON(obj4))
    var diff = msgpack.encode( jsonpatch.generate(observer2) )
  }
})

var obj4 = new PlainState();
var oldBinary4 = msgpack.encode( toJSON( obj4 ) )
var newBinary4 = null
suite.add('using plain + fossildelta', function() {
  for (var i=0; i<4; i++) {
    obj4.objs[0].hp--;
    obj4.objs[2].hp--;
    obj4.teams[i].score++;
    newBinary4 = msgpack.encode( toJSON( obj4 ) )
    var diff = fossilDelta.create( oldBinary4, newBinary4 )
    oldBinary4 = newBinary4
  }
})

var obj5 = new ComplexState();
var oldBinary5 = msgpack.encode( toJSON( obj4 ) )
var newBinary5 = null
suite.add('using complex + fossildelta', function() {
  for (var i=0; i<4; i++) {
    obj5.objs[0].hp--;
    obj5.objs[2].hp--;
    obj5.teams[i].score++;
    newBinary5 = msgpack.encode( toJSON( obj5 ) )
    var diff = fossilDelta.create( oldBinary5, newBinary5 )
    oldBinary5 = newBinary5
  }
})

suite.on('cycle', function(event) {
  console.log(String(event.target));
})

suite.run()

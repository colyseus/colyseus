"use strict";

console.log('benchmark: evaluating a complex patch state')

var Benchmark = require('benchmark')
  , Immutable = require('immutable')
  , immutablediff = require('immutable-diff')
  , jsonpatch = require('fast-json-patch')

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
function toJSON(obj) {
  var result

    if (obj && typeof(obj.toJSON)==="function") {
      result = obj.toJSON()

        for (var k in result) {
          result[k] = toJSON(result[k])
        }

    } else if (obj instanceof Array) {
      result = obj.map((_) => toJSON(_))

    } else {
      result = obj
    }

  return result
}

var obj1 = new ComplexState();
var state1 = Immutable.fromJS(toJSON(obj1)).toJS();
suite.add('using immutable', function() {
  for (var i=0; i<4; i++) {
    obj1.objs[0].hp--;
    obj1.objs[2].hp--;
    obj1.teams[i].score++;
    var newState = Immutable.fromJS(toJSON(obj1)).toJS();
    var diff = jsonpatch.compare(state1, newState);
    state1 = newState
  }
})

var obj11 = new ComplexState();
var state11 = Immutable.fromJS(toJSON(obj11));
suite.add('using immutable + immutable-diff', function() {
  for (var i=0; i<4; i++) {
    obj11.objs[0].hp--;
    obj11.objs[2].hp--;
    obj11.teams[i].score++;
    var newState = Immutable.fromJS(toJSON(obj11));
    var diff = immutablediff.default(state11, newState).toJS();
    state11 = newState
  }
})

var obj2 = new ComplexState();
var state2 = JSON.parse(JSON.stringify(toJSON(obj2)))
suite.add('using json', function() {
  for (var i=0; i<4; i++) {
    obj2.objs[0].hp--;
    obj2.objs[2].hp--;
    obj2.teams[i].score++;
    var newState = JSON.parse(JSON.stringify(toJSON(obj2)))
    var diff = jsonpatch.compare(state2, newState);
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
    var diff = jsonpatch.generate(observer)
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
    var diff = jsonpatch.generate(observer2)
  }
})

suite.on('cycle', function(event) {
  console.log(String(event.target));
})

suite.run()

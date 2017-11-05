"use strict";

var assert = require('assert')
  , StateObserver = require('../../lib/state/Observer').StateObserver
  , msgpack = require('notepack.io')

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

class Property {
  constructor (prop)  {
    this.prop = prop
  }
  set (v) { this.prop = v }
  toJSON () { return this.prop }
}

class ChildObject {
  constructor (hp, x, y, parent) {
    this.complexObject = global
    this.parent = parent
    this.hp = hp
    this.prop = new Property(10)
    this.x = x
    this.y = y
  }
  child_method () {
    return true
  }
  toJSON () {
    return { hp: this.hp, x: this.x, y: this.y, prop: this.prop }
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
    this.prop = new Property(1)
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
      teams: this.teams,
      prop: this.prop
    }
  }
}

describe('StateObserver', function() {
  describe('plain object state', function() {
    var state = new PlainState()
    var observer = new StateObserver(state)

    it('shouldn\'t have patches to apply', function() {
      assert.deepEqual(observer.getPatches(), [])
    })

    it('should have patches to apply', function() {
      state.string = "Changed!"
      var patches = observer.getPatches()
      assert.equal(patches.length, 1)
      assert.deepEqual(patches, [ { op: 'replace', path: '/string', value: 'Changed!' } ])
    })

    it('should get diff state', function() {
      var time = Date.now()
      state.array[9] = 20
      state.array.push(21)

      state.objs[2].x = 100
      state.objs.push({ hp: 80, x: 100, y: 200 })

      var diff = observer.getPatches()
      var diffTime = Date.now() - time

      assert.deepEqual(diff, [
        { op: 'replace', path: '/objs/2/x', value: 100 },
        { op: 'add', path: '/objs/3', value: { hp: 80, x: 100, y: 200 } },
        { op: 'replace', path: '/array/9', value: 20 },
        { op: 'add', path: '/array/10', value: 21 }
      ])

      assert.ok(diffTime <= 5)
    })

    it('should support deep mutations', function() {
      assert.equal(observer.getPatches().length, 0)
      state.teams[0].score += 1
      assert.equal(observer.getPatches().length, 1)
    })
  })

  describe('classy object state (generated through toJSON method)', function() {
    var state = new ComplexState()
    var observer = new StateObserver(state)

    it('shouldn\'t have patches to apply', function() {
      assert.deepEqual(observer.getPatches(), [])
    })

    it('should have patches to apply', function() {
      state.string = "Changed!"
      var patches = observer.getPatches()
      assert.equal(patches.length, 1)
      assert.deepEqual(patches, [ { op: 'replace', path: '/string', value: 'Changed!' } ])
    })

    it('should get diff state', function() {
      var time = Date.now()
      state.array[9] = 20
      state.array.push(21)

      state.objs[2].x = 100
      state.add(80, 100, 200)

      var diff = observer.getPatches()
      var diffTime = Date.now() - time

      assert.deepEqual(diff, [
        { op: 'replace', path: '/objs/2/x', value: 100 },
        { op: 'add', path: '/objs/3', value: { hp: 80, prop: 10, x: 100, y: 200 } },
        { op: 'replace', path: '/array/9', value: 20 },
        { op: 'add', path: '/array/10', value: 21 }
      ])

      assert.ok(diffTime <= 5)
    })

    it('should support deep mutations', function() {
      assert.equal(observer.getPatches().length, 0)
      state.teams[0].score += 1
      assert.equal(observer.getPatches().length, 1)
    })

    it('original state objects shouldn\'t be mutated', function() {
      var jsonState = observer.toJSON(state)
      state.prop.set( 20 )
      assert.equal(state.prop.toJSON(), 20)
    })

  })

});

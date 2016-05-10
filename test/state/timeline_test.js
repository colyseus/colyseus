"use strict";

var assert = require('assert')
  , Timeline = require('../../lib/state/timeline')

describe('Timeline', function() {

  var timeline = new Timeline()
  timeline.entities = { "one": 10 }
  timeline.start()

  // fake 100ms later
  timeline.clock.elapsedTime = 100
  timeline.entities.one = 5
  timeline.takeSnapshot()

  // fake 200ms later
  timeline.clock.elapsedTime = 200
  timeline.entities.one = 0
  timeline.takeSnapshot()

  describe("#at (without interpolation/extrapolation)", function() {

    it("should find closest snapshot by time distance", function() {

      assert.deepEqual( timeline.at( 0, false ), { entities: { "one": 10 } } )
      assert.deepEqual( timeline.at( 20, false ), { entities: { "one": 10 } } )
      assert.deepEqual( timeline.at( 80, false ), { entities: { "one": 5 } } )

      assert.deepEqual( timeline.at( 100, false ), { entities: { "one": 5 } } )
      assert.deepEqual( timeline.at( 140, false ), { entities: { "one": 5 } } )

      assert.deepEqual( timeline.at( 200, false ), { entities: { "one": 0 } } )
      assert.deepEqual( timeline.at( 210, false ), { entities: { "one": 0 } } )
      assert.deepEqual( timeline.at( 10000, false ), { entities: { "one": 0 } } )

    })

  })

  describe("#at (with interpolation)", function() {

    it("no need to interpolate end of frames", function() {

      assert.deepEqual(timeline.at( 0 ), { entities: { "one": 10 } } )
      assert.deepEqual( timeline.at( 100 ), { entities: { "one": 5 } } )
      assert.deepEqual(timeline.at( 200 ), { entities: { "one": 0 } } )

    })

    it("should interpolate values between known snapshots", function() {

      assert.deepEqual( timeline.at( 50 ), { entities: { "one": 7.5 } } )
      assert.deepEqual( timeline.at( 150 ), { entities: { "one": 2.5 } } )

    })

    it("should extrapolate future time requests", function() {

      assert.deepEqual( timeline.at( 300 ), { entities: { "one": -5 } } )
      assert.deepEqual( timeline.at( 400 ), { entities: { "one": -10 } } )
      assert.deepEqual( timeline.at( 500 ), { entities: { "one": -15 } } )

    })

  })

});

"use strict";

var assert = require('assert')
  , Timeline = require('../../lib/state/timeline')

describe('Timeline', function() {

  describe("#at (without interpolation)", function() {

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

    it.only("should find closest snapshot by time distance", function() {

      assert.deepEqual({ entities: { "one": 10 } }, timeline.at( 0, false ) )
      assert.deepEqual({ entities: { "one": 10 } }, timeline.at( 20, false ) )
      assert.deepEqual({ entities: { "one": 5 } }, timeline.at( 80, false ) )

      assert.deepEqual({ entities: { "one": 5 } }, timeline.at( 100, false ) )
      assert.deepEqual({ entities: { "one": 5 } }, timeline.at( 140, false ) )

      assert.deepEqual({ entities: { "one": 0 } }, timeline.at( 200, false ) )
      assert.deepEqual({ entities: { "one": 0 } }, timeline.at( 210, false ) )
      assert.deepEqual({ entities: { "one": 0 } }, timeline.at( 10000, false ) )

    })

  })

  // describe('#takeSnapshot', function() {
  //
  //   it('shoult take snapshot when requested', function() {
  //     var timeline = new Timeline()
  //     timeline.entities = {
  //       "one": {"x": 10, "y": 10},
  //       "two": {"x": 0, "y": 0},
  //     }
  //     timeline.start()
  //
  //     // fake 100ms later
  //     timeline.clock.elapsedTime = 100
  //
  //     timeline.entities.one.x = 5
  //     timeline.takeSnapshot()
  //
  //     assert.equal(100, timeline.lastSnapshotTime)
  //
  //     assert.deepEqual({entities:{
  //       one: {x: 10, y: 10},
  //       two: {x: 0, y: 0},
  //     }}, timeline.at( 100 ))
  //
  //   });
  //
  // });
  //
  // describe("interpolation and extrapolation", function() {
  //
  //   var timeline = new Timeline()
  //   timeline.entities = {
  //     "one": {"x": 10, "y": 10},
  //     "two": {"x": 0, "y": 0},
  //   }
  //   timeline.start()
  //
  //   // fake 100ms later
  //   timeline.clock.elapsedTime = 100
  //   timeline.entities.one.x = 5
  //   timeline.takeSnapshot()
  //
  //   // fake 200ms later
  //   timeline.clock.elapsedTime = 200
  //   timeline.entities.one.x = 0
  //   timeline.entities.two.x = 5
  //   timeline.takeSnapshot()
  //
  //   it('should interpolate values using previous snapshot data', function() {
  //
  //     assert.equal(3, timeline.history.length)
  //
  //     console.log( timeline.at(0) )
  //
  //     // entity one
  //     assert.equal(10, timeline.at(0).entities.one.x)
  //     assert.equal(7.5, timeline.at(50).entities.one.x)
  //     assert.equal(5, timeline.at(100).entities.one.x)
  //
  //     // entity two
  //     assert.equal(0, timeline.at(0).entities.two.x)
  //     assert.equal(5, timeline.at(200).entities.two.x)
  //
  //   })
  //
  //   it('should extrapolate values using future time (without data)', function() {
  //
  //     // assert.equal(5, timeline.at(200).entities.two.x)
  //
  //   })
  //
  // })


});

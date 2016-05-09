"use strict";

var assert = require('assert')
  , Timeline = require('../../lib/state/timeline')

describe('Timeline', function() {

  describe('#takeSnapshot', function() {

    it('shoult take snapshot when requested', function() {
      var timeline = new Timeline({ })
      timeline.entities = {
        "one": {"x": 10, "y": 10},
        "two": {"x": 0, "y": 0},
      }
      timeline.start()

      // fake 100ms later
      timeline.clock.elapsedTime = 100

      timeline.entities.one.x = 5
      timeline.takeSnapshot()

      assert.equal(100, timeline.lastSnapshotTime)

      assert.deepEqual({entities:{
        one: {x: 10, y: 10},
        two: {x: 0, y: 0},
      }}, timeline.getSnapshotAt( 0 ))

    });

  });

  describe("#interpolate", function() {
    it('should interpolate values using previous snapshot data')
      var timeline = new Timeline({ })
      timeline.entities = {
        "one": {"x": 10, "y": 10},
        "two": {"x": 0, "y": 0},
      }
      timeline.start()

      // fake 100ms later
      timeline.clock.elapsedTime = 100

      timeline.entities.one.x = 5
      timeline.takeSnapshot()

      assert.equal(7.5, timeline.getSnapshotAt(50).entities.one.x)
  })


});



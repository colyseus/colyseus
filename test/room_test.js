var assert = require('assert')
  , Room = require('../lib/room')

class DummyRoom extends Room {
  requestJoin (options) {
    return !options.invalid_param
  }
}

class DummyRoomWithUpdate extends Room {
  constructor (options) {
    options.updateInterval = 1000;
    super(options)
  }
  requestJoin (options) {
    return !options.invalid_param
  }
  update() {  }
}

describe('Room', function() {

  describe('constructor', function() {
    it('should instantiate with valid options', function() {
      var room = new DummyRoom({ })
      assert.equal('DummyRoom', room.constructor.name)
    });

    it('should throw error instantiating with invalid options', function() {
      assert.throws(() => {
        var room = new DummyRoom({ invalid_param: true })
      }, Error);
    });
  });

  describe('interval', function() {
    it('should not default interval without "updateInterval" option', function() {
      var room = new DummyRoom({ })
      assert.equal(undefined, room._updateInterval)
    })

    it('should set default interval with "updateInterval" and "update" declared', function() {
      var room = new DummyRoomWithUpdate({ })
      assert.equal("object", typeof(room._updateInterval))
    })
  })

});


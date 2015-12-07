var Room = require('../lib/room')

class DummyRoom extends Room {

  requestJoin (options) {
    return !options.invalid_param
  }

}

module.exports = DummyRoom

var assert = require('assert')
  , Server = require('../lib/server')
  , Room = require('../lib/room')
  , mock = require('./mock')

class DummyRoom extends Room {
  requestJoin (options) {
    return !options.invalid_param
  }
}

describe('Server', function() {
  var server = new Server({port: 1111})
  var clients = []

  // register dummy room
  server.register('room', DummyRoom)

  // connect 5 clients into server
  before(function() {
    for (var i=0; i<5; i++) {
      var client = mock.createEmptyClient()
      clients.push(client)
      server.onConnect(client)
    }
  })

  after(function() {
    // disconnect dummy clients
    for (var id in clients) {
      clients[ id ].close()
    }
  })

  describe('join request', function() {
    it('should join a room with valid options', function() {
      assert.doesNotThrow(function() {
        server.onJoinRoomRequest(clients[0], 'room', {})
      })
    })

    it('should\'nt join a room with invalid options', function() {
      assert.throws(function() {
        server.onJoinRoomRequest(clients[0], 'room', { invalid_param: 10 })
      }, /join_request_fail/)
    })
  });
});

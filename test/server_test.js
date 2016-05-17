"use strict";

var assert = require('assert')
  , Server = require('../lib/server')
  , Room = require('../lib/room')
  , mock = require('./utils/mock')
  , msgpack = require('msgpack-lite')
  , protocol = require('../lib/protocol')

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
  server.register('invalid_room', DummyRoom)

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

      let client = clients[0]

      assert.doesNotThrow(function() {
        server.onJoinRoomRequest(client, 'room', {})
      })

      assert.equal( 2, client.messages.length )
      assert.equal( protocol.USER_ID, msgpack.decode(client.messages[0])[0] )
      assert.equal( protocol.JOIN_ROOM, msgpack.decode(client.messages[1])[0] )

    })

    it('shouldn\'t join a room with invalid options', function() {

      let client = clients[1]

      assert.throws(function() {
        server.onJoinRoomRequest(client, 'invalid_room', { invalid_param: 10 })
      }, /join_request_fail/)

      assert.equal( 1, client.messages.length )
      assert.equal( protocol.USER_ID, msgpack.decode(client.messages[0])[0] )

    })
  });
});

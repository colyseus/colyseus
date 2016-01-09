"use strict";

var assert = require('assert')
  , Room = require('../lib/room')
  , protocol = require('../lib/protocol')

  , mock = require('./utils/mock')
  , msgpack = require('msgpack-lite')

class DummyRoom extends Room {
  requestJoin (options) {
    return !options.invalid_param
  }
}

describe('Room', function() {

  describe('#constructor', function() {
    it('should instantiate with valid options', function() {
      var room = new DummyRoom({ })
      assert.equal('DummyRoom', room.constructor.name)
    });
  });

  describe('#onJoin/#onLeave', function() {
    it('should receive onJoin/onLeave messages', function() {
      var room = new DummyRoom({ })
      var client = mock.createDummyClient()
      var message = null

      room._onJoin(client, {})

      assert.equal(client.messages.length, 1)

      message = msgpack.decode(client.messages[0])
      assert.equal(message[0], protocol.JOIN_ROOM)

      room._onLeave(client)
      message = msgpack.decode(client.messages[1])
      assert.equal(message[0], protocol.LEAVE_ROOM)
    })

    it('should cleanup/dispose when all clients disconnect', function(done) {
      var room = new DummyRoom({ })
      var client = mock.createDummyClient()

      room._onJoin(client)
      assert.equal(typeof(room._patchInterval._repeat), "function")

      room.on('dispose', function() {
        assert.equal(typeof(room._patchInterval._repeat), "object")
        done()
      })

      room._onLeave(client)
    })
  })

  describe('patch interval', function() {
    it('should set default "patch" interval', function() {
      var room = new DummyRoom({ })
      assert.equal("object", typeof(room._patchInterval))
      assert.equal(1000 / 20, room._patchInterval._idleTimeout, "default patch rate should be 20")
    })
  })

  describe('#sendState/#broadcastState', function() {
    var room = new DummyRoom({ })
    var client = mock.createDummyClient()
    room._onJoin(client, {})

    it('should throw an exception without initializing state', function() {
      assert.throws(function() { room.sendState(client) }, /getState/)
      assert.throws(function() { room.broadcastState(client) }, /getState/)
    })

    it('should send state when it is set up', function() {
      room.setState({ success: true })

      // first message
      room.sendState(client)

      var message = msgpack.decode( client.messages[1] )
      assert.equal(message[0], protocol.ROOM_STATE)
      assert.deepEqual(message[2], { success: true })

      // second message
      room.broadcastState(client)

      var message = msgpack.decode( client.messages[2] )
      assert.equal(message[0], protocol.ROOM_STATE)
      assert.deepEqual(message[2], { success: true })
    })
  })

  describe('#broadcastPatch', function() {
    it('shouldn\'t broadcast patch with no state or no patches', function() {
      var room = new DummyRoom({ })
      assert.equal(null, room.state)
      assert.equal(false, room.broadcast())
      assert.equal(false, room.broadcastPatch())

      room.setState({one: 1})
      assert.deepEqual({one: 1}, room.state)
      assert.equal(false, room.broadcast())
      assert.equal(false, room.broadcastPatch())
    })

    it('shouldn\'t broadcast clean state (no patches)', function() {
      var room = new DummyRoom({ })
      room.setState({ one: 1 })

      // create 2 dummy connections with the room
      var client = mock.createDummyClient()
      room._onJoin(client, {})

      var client2 = mock.createDummyClient()
      room._onJoin(client2, {})

      assert.deepEqual({one: 1}, room.state)
      assert.equal(false, room.broadcastPatch(), "shoudn't broadcast clean state")

      room.state.two = 2
      assert.deepEqual({one: 1, two: 2}, room.state)
      assert.equal(true, room.broadcastPatch(), "should broadcast patches")

      assert.equal(client.messages.length, 2)
      assert.equal(client2.messages.length, 2)

      var message = msgpack.decode(client.messages[1])
      assert.equal(message[0], protocol.ROOM_STATE_PATCH)
      assert.deepEqual(message[2], [{ op: 'add', path: '/two', value: 2 }])
    })
  })

});


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

class DummyRoomWithState extends Room {
  constructor(options) {
    super(options)
    this.setState({ number: 10 })
  }
  requestJoin (options) {
    return !options.invalid_param
  }
}

class DummyRoomWithTimeline extends Room {
  constructor(options) {
    super(options)
    this.useTimeline()
  }
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

    it('should instantiate with timeline attribute', function() {
      var room = new DummyRoomWithTimeline({ })
      assert.equal(0, room.timeline.history.length)
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

    it('should receive JOIN_ROOM and ROOM_DATA messages onJoin', function() {
      var room = new DummyRoomWithState({ })
      var client = mock.createDummyClient()
      var message = null

      room._onJoin(client, {})

      assert.equal(client.messages.length, 2)

      message = msgpack.decode(client.messages[0])
      assert.equal(message[0], protocol.JOIN_ROOM)

      message = msgpack.decode(client.messages[1])
      assert.equal(message[0], protocol.ROOM_STATE)
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
    it('should send state when it is set up', function() {
      let room = new DummyRoom({ })
      let client = mock.createDummyClient()
      room._onJoin(client, {})

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
    it('should broadcast patch with no state or no patches', function() {
      let room = new DummyRoom({ })

      // connect 2 dummy clients into room
      let client1 = mock.createDummyClient()
      room._onJoin(client1, {})

      let client2 = mock.createDummyClient()
      room._onJoin(client2, {})

      assert.equal(null, room.state)

      assert.throws(() => { room.broadcast() })
      assert.throws(() => { room.broadcastPatch() })

      // ideally patches should be empty if nothing has changed
      assert.equal( 1, client1.messages.length )

      room.setState({one: 1})
      assert.deepEqual({one: 1}, room.state)
      assert.equal(true, room.broadcast())
      assert.equal(true, room.broadcastPatch())
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
      assert.equal(true, room.broadcastPatch())

      room.state.two = 2
      assert.deepEqual({one: 1, two: 2}, room.state)
      assert.equal(true, room.broadcastPatch())

      assert.equal(client.messages.length, 4)
      assert.equal(client2.messages.length, 4)

      // first message, join room
      var message = msgpack.decode(client.messages[0])
      assert.equal(message[0], protocol.JOIN_ROOM)

      // second message, room state
      var message = msgpack.decode(client.messages[1])
      assert.equal(message[0], protocol.ROOM_STATE)

      // third message, empty patch state
      var message = msgpack.decode(client.messages[2])
      assert.equal(message[0], protocol.ROOM_STATE_PATCH)
      assert.deepEqual(message[2].length, 17)
      // // TODO: ideally empty patch state should have 0 length
      // assert.deepEqual(message[2].length, 0)

      // fourth message, room patch state
      var message = msgpack.decode(client.messages[3])
      assert.equal(message[0], protocol.ROOM_STATE_PATCH)

      assert.deepEqual(message[2], [ 66, 10, 66, 58, 130, 163, 111, 110, 101, 1, 163, 116, 119, 111, 2, 49, 86, 53, 49, 74, 89, 59 ])
    })
  })

});


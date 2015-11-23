var EventEmitter = require('events')
  , msgpack = require('msgpack-lite')

  , jsonpatch = require('fast-json-patch')
  , protocol = require('./protocol')
  , utils = require('./utils')

class Room extends EventEmitter {

  constructor (options, initialState) {
    super()

    this.clients = []
    this.options = options

    // initialize room with empty state
    this.setState(initialState || {})

    if (this.constructor.updateInterval && this.update) {
      this.updateInterval = setInterval(this.update.bind(this), this.constructor.updateInterval)
    }
  }

  setState (newState) {
    this.state = newState
    this.observer = jsonpatch.observe(this.state)
  }

  requestJoin (options) {
    // return (this.options.clientsPerRoom == options.clientsPerRoom)
    return true;
  }

  // onMessage (client, data) { }
  // onJoin (client, options) { }
  // onLeave (client) { }
  // update () { }
  // dispose () { }

  _onMessage (client, data) {
    if (this.onMessage) this.onMessage(client, data)
  }

  _onJoin (client, options) {
    this.clients.push( client )
    if (this.onJoin) this.onJoin(client, options)
  }

  _onLeave (client) {
    // remove client from client list
    utils.spliceOne(this.clients, this.clients.indexOf(client))

    if (this.onLeave) this.onLeave(client)

    // custom cleanup method & clear intervals
    if (this.clients.length == 0) {
      if (this.dispose) this.dispose();
      clearInterval(this.updateInterval)
      this.emit('dispose')
    }
  }

  lock () { this.emit('lock') }
  unlock () { this.emit('unlock') }

  sendState (client) {
    client.send( msgpack.encode([ protocol.ROOM_STATE, this.state ]) )
  }

  broadcast (data) {
    if (!data) {
      let patches = jsonpatch.generate(this.observer)

      // nothing changed, no diff to broadcast...
      if (patches.length === 0) { return false }

      // broadcast state data diff by default
      data = msgpack.encode( [protocol.ROOM_STATE_PATCH, patches] )

    } else if (!(data instanceof Buffer)) {
      // encode message with msgpack
      data = msgpack.encode(data)
    }

    this.clients.forEach(client => client.send(data, { binary: true }))
  }

}

Room.updateInterval = 1000
Room.isValidOptions = function(options) { return true; }

module.exports = Room

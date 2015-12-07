var EventEmitter = require('events')
  , shortid = require('shortid')
  , msgpack = require('msgpack-lite')

  , jsonpatch = require('fast-json-patch')
  , protocol = require('./protocol')
  , utils = require('./utils')

class Room extends EventEmitter {

  constructor (options, initialState) {
    super()

    this.roomId = options.roomId
    this.roomName = options.roomName

    this.clients = []
    this.options = options

    // initialize room with empty state
    this.setState(initialState || {})

    if (!this.requestJoin(options)) {
      throw new Error(`Can't join ${ options.roomName }`)
    }

    if (options.updateInterval && this.update) {
      this._updateInterval = setInterval(this.update.bind(this), options.updateInterval)
    }
  }

  setState (newState) {
    this.state = newState
    this.observer = jsonpatch.observe(this.state)
  }

  requestJoin (options) {
    return true;
  }

  lock () { this.emit('lock') }
  unlock () { this.emit('unlock') }

  send (client, data) {
    client.send( msgpack.encode( data ), { binary: true }, utils.logError.bind(this) )
  }

  sendState (client) {
    client.send( msgpack.encode( [ protocol.ROOM_STATE, this.roomId, this.state ] ), { binary: true }, utils.logError.bind(this) )
  }

  broadcastState () {
    this.broadcast( msgpack.encode([ protocol.ROOM_STATE, this.roomId, this.state ]) )
  }

  broadcastPatch () {
    let patches = jsonpatch.generate(this.observer)

    // nothing changed, no diff to broadcast...
    if (patches.length === 0) {
      return false
    }

    // broadcast state data diff by default
    this.broadcast( msgpack.encode([ protocol.ROOM_STATE_PATCH, this.roomId, patches ]) )
  }

  broadcast (data) {
    if (!data) return this.broadcastPatch();

    // encode all messages with msgpack
    if (!(data instanceof Buffer)) {
      data = msgpack.encode([protocol.ROOM_DATA, this.roomId, data])
    }

    this.clients.forEach(client => client.send(data, { binary: true }, utils.logError.bind(this) ))
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
    this.send(client, [protocol.JOIN_ROOM, this.roomId, this.roomName])
    if (this.onJoin) this.onJoin(client, options)
  }

  _onLeave (client, isDisconnect) {
    // remove client from client list
    utils.spliceOne(this.clients, this.clients.indexOf(client))

    if (this.onLeave) this.onLeave(client)

    if (!isDisconnect) {
      this.send([protocol.LEAVE_ROOM, this.roomId])
    }

    // custom cleanup method & clear intervals
    if (this.clients.length == 0) {
      if (this.dispose) this.dispose();
      clearInterval(this._updateInterval)
      this.emit('dispose')
    }
  }

}

module.exports = Room

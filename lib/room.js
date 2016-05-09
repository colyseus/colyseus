"use strict";

var EventEmitter = require('events')
  , shortid = require('shortid')
  , msgpack = require('msgpack-lite')
  , ClockTimer = require('clock-timer.js')

  , StateObserver = require('./state/observer')
  , protocol = require('./protocol')
  , utils = require('./utils')

class Room extends EventEmitter {

  constructor (options, patchRate) {
    super()

    // default patch rate = 20fps (50ms)
    if (!patchRate) { patchRate = (1000 / 20) }

    this.clock = new ClockTimer()

    this.roomId = options.roomId
    this.roomName = options.roomName

    this.clients = []
    this.options = options

    // this._updateInterval = setInterval( this.update.bind(this), patchRate )
    this._patchInterval = setInterval( this.patch.bind(this), patchRate )
  }

  setState (newState) {
    this.state = newState
    this.stateObserver = new StateObserver(this.state)
  }

  requestJoin (options) {
    return true;
  }

  lock () { this.emit('lock') }
  unlock () { this.emit('unlock') }

  send (client, data) {
    client.send( msgpack.encode( [protocol.ROOM_DATA, this.roomId, data] ), { binary: true }, utils.logError.bind(this) )
  }

  sendState (client) {
    client.send( msgpack.encode( [ protocol.ROOM_STATE, this.roomId, this.stateObserver.getState() ] ), { binary: true }, utils.logError.bind(this) )
  }

  broadcastState () {
    return this.broadcast( msgpack.encode([ protocol.ROOM_STATE, this.roomId, this.stateObserver.getState() ], { binary: true }, utils.logError.bind(this)) )
  }

  broadcastPatch () {
    let patches = (this.stateObserver) ? this.stateObserver.getPatches() : []

    // nothing changed, no diff to broadcast...
    if (patches.length === 0) {
      return false
    }

    // broadcast state data diff by default
    return this.broadcast( msgpack.encode([ protocol.ROOM_STATE_PATCH, this.roomId, patches ]) )
  }

  broadcast (data) {
    // no data given, try to broadcast patched state
    if (!data) { return this.broadcastPatch() }

    // encode all messages with msgpack
    if (!(data instanceof Buffer)) {
      data = msgpack.encode([protocol.ROOM_DATA, this.roomId, data])
    }

    var numClients = this.clients.length;
    while (numClients--) {
      this.clients[ numClients ].send(data, { binary: true }, utils.logError.bind(this) )
    }

    return true
  }

  // onMessage (client, data) { }
  // onJoin (client, options) { }
  // onLeave (client) { }
  // dispose () { }

  patch () {
    // broadcast patched state to all clients
    this.broadcastPatch()
  }

  _onMessage (client, data) {
    if (this.onMessage) this.onMessage(client, data)
  }

  _onJoin (client, options) {
    this.clients.push( client )
    client.send( msgpack.encode( [protocol.JOIN_ROOM, this.roomId, this.roomName] ), { binary: true }, utils.logError.bind(this) )

    // send current state when new client joins the room
    if (this.state) this.sendState(client);

    if (this.onJoin) this.onJoin(client, options)
  }

  _onLeave (client, isDisconnect) {
    // remove client from client list
    utils.spliceOne(this.clients, this.clients.indexOf(client))

    if (this.onLeave) this.onLeave(client)
    this.emit('leave', client, isDisconnect)

    if (!isDisconnect) {
      client.send( msgpack.encode( [protocol.LEAVE_ROOM, this.roomId] ), { binary: true }, utils.logError.bind(this) )
    }

    // custom cleanup method & clear intervals
    if (this.clients.length == 0) {
      if (this.dispose) this.dispose();
      clearInterval(this._patchInterval)
      this.emit('dispose')
    }
  }

  disconnect () {
    var i = this.clients.length;
    while (i--) { this._onLeave( this.clients[i] ) }
  }

}

module.exports = Room

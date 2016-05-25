"use strict";

var EventEmitter = require('events')
  , shortid = require('shortid')
  , msgpack = require('msgpack-lite')
  , fossilDelta = require('fossil-delta')
  , ClockTimer = require('clock-timer.js')
  , createTimeline = require('timeframe').createTimeline

  , protocol = require('./protocol')
  , utils = require('./utils')

class Room extends EventEmitter {

  constructor ( options ) {

    super()

    this.clock = new ClockTimer()

    this.roomId = options.roomId
    this.roomName = options.roomName

    this.clients = []
    this.options = options

    // Default patch rate is 20fps (50ms)
    this.setPatchRate( 1000 / 20 )

  }

  setSimulationInterval ( callback, delay ) {

    // Default simulation interval is 60fps (16ms)
    if ( !delay ) delay = 1000 / 60

    // clear previous interval in case called setSimulationInterval more than once
    if ( this._simulationInterval ) clearInterval( this._simulationInterval )

    this._simulationInterval = setInterval( () => {

      this.clock.tick()
      callback()

    }, delay )

  }

  setPatchRate ( milliseconds ) {

    // clear previous interval in case called setPatchRate more than once
    if ( this._patchInterval ) clearInterval(this._patchInterval)

    this._patchInterval = setInterval( this.patch.bind(this), milliseconds )

  }

  useTimeline ( maxSnapshots ) {

    this.timeline = createTimeline( maxSnapshots )

  }

  setState (newState) {

    this.clock.start()

    this.state = newState
    this._previousState = this.getEncodedState()

    if ( this.timeline ) {
      this.timeline.takeSnapshot( this.state )
    }

  }

  requestJoin (options) {

    return true;

  }

  lock () {

    this.emit('lock')

  }

  unlock () {

    this.emit('unlock')

  }

  send (client, data) {

    client.send( msgpack.encode( [protocol.ROOM_DATA, this.roomId, data] ), { binary: true }, utils.logError.bind(this) )

  }

  sendState (client) {

    client.send( msgpack.encode( [
      protocol.ROOM_STATE,
      this.roomId,
      utils.toJSON( this.state ),
      this.clock.currentTime,
      this.clock.elapsedTime,
    ] ), {
      binary: true
    }, utils.logError.bind(this) )

  }

  broadcastState () {

    return this.broadcast( msgpack.encode([
      protocol.ROOM_STATE,
      this.roomId,
      utils.toJSON( this.state )
    ], {
      binary: true
    }, utils.logError.bind(this)) )

  }

  broadcastPatch () {

    let newState = this.getEncodedState()
    let patches = fossilDelta.create( this._previousState, newState )

    if ( this.timeline && newState !== this._previousState ) {

      // take a snapshot of the current state
      this.timeline.takeSnapshot( this.state, this.clock.elapsedTime )

    }

    this._previousState = newState

    // broadcast patches (diff state) to all clients,
    // even if nothing has changed in order to calculate PING on client-side
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

  patch () {

    // broadcast patched state to all clients
    this.broadcastPatch()

  }

  _onMessage (client, data) {

    if (this.onMessage) this.onMessage(client, data)

  }

  _onJoin (client, options) {

    this.clients.push( client )

    // confirm room id that matches the room name requested to join
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
    if ( this.clients.length == 0 ) {

      if ( this.onDispose ) this.onDispose();
      if ( this._patchInterval ) clearInterval( this._patchInterval )
      if ( this._simulationInterval ) clearInterval( this._simulationInterval )

      this.emit('dispose')

    }

  }

  getEncodedState () {

    return msgpack.encode( utils.toJSON( this.state ) )

  }

  disconnect () {

    var i = this.clients.length;
    while (i--) { this._onLeave( this.clients[i] ) }

  }

}

module.exports = Room

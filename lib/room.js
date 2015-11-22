var EventEmitter = require('events')
  , msgpack = require('msgpack-lite')
  , utils = require('./utils')

class Room extends EventEmitter {

  constructor (options) {
    super()

    this.clients = []
    this.state = {}
    this.lastState = {}
    this.options = options

    if (this.constructor.updateInterval && this.update) {
      this.updateInterval = setInterval(this.update.bind(this), this.constructor.updateInterval)
    }
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

  broadcast (data) {
    if (!data) {
      // broadcast state data diff by default
      data = msgpack.encode(utils.diff(this.lastState, this.state))
      this.lastState = this.state

    } else if (!(data instanceof Buffer)) {
      // encode message with msgpack
      data = msgpack.encode(data)
    }

    this.clients.forEach(client => client.send(data))
  }

}

Room.updateInterval = 1000
Room.isValidOptions = function(options) { return true; }

module.exports = Room

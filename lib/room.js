var RoomState = require('./room_state')
  , EventEmitter = require('events')

class Room extends EventEmitter {

  constructor (options) {
    super()

    this.state = new RoomState()
    this.options = options

    if (this.constructor.updateInterval && this.update) {
      this.updateInterval = setInterval(this.update.bind(this), this.constructor.updateInterval)
    }
  }

  requestJoin (options) { return (this.options == options) }
  onMessage (client, data) { }

  // onJoin (client, options) { }
  // onLeave (client) { }
  // update () { }
  // dispose () { }

  _onJoin (client, options) {
    this.state.clients += 1
    if (this.onJoin) this.onJoin(client, options)
  }

  _onLeave (client) {
    this.state.clients -= 1
    if (this.onLeave) this.onLeave(client)

    // custom cleanup method & clear intervals
    if (this.state.clients == 0) {
      if (this.dispose) this.dispose();
      clearInterval(this.updateInterval)
      this.emit('dispose')
    }
  }

  // helper methods
  broadcast (data) {
    this.clients.forEach(function(client) {
      client.send(data)
    })
  }

}

Room.updateInterval = 1000
Room.isValidOptions = function(options) { return true; }

module.exports = Room

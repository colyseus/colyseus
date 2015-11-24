var EventEmitter = require('events').EventEmitter
  , protocol = require('../protocol')

class Room extends EventEmitter {

  constructor (client, name) {
    super()

    this.roomId = null
    this.client = client
    this.name = name
    this.state = {}
  }

  leave () {
    if (this.roomId) {
      this.client.send([protocol.LEAVE_ROOM, this.roomId])
    }
  }

}

module.exports = Room

var utils = require('./utils')

class MatchMaker {

  constructor () {
    this.handlers = {}
    this.availableRooms = {}
    this.activeMatches = []
    this.roomCount = 0
  }

  addHandler (name, handler, options) {
    this.handlers[ name ] = [handler, options || {}]
    this.availableRooms[ name ] = []
  }

  hasHandler (roomName) {
    return this.handlers[ roomName ]
  }

  hasAvailableRoom (roomName) {
    return (this.availableRooms[ roomName ] &&
      this.availableRooms[ roomName ].length > 0)
  }

  joinOrCreate (client, roomName, clientOptions) {
    var room = null

    if (this.hasAvailableRoom(roomName)) {
      room = this.requestJoin(client, roomName, clientOptions)
    }

    if (!room) {
      room = this.create(client, roomName, clientOptions)
    }

    return room
  }

  requestJoin (client, roomName, clientOptions) {
    for (var i=0; i<this.availableRooms[ roomName ].length; i++) {
      let availableRoom = this.availableRooms[ roomName ][i]
      if (availableRoom.requestJoin(clientOptions)) {
        return availableRoom
      }
    }
    return false
  }

  create (client, roomName, clientOptions) {
    var room = null
      , handler = this.handlers[ roomName ][0]
      , options = this.handlers[ roomName ][1]

    // TODO:
    // keep track of available roomId's
    // try to use 0~127 in order to have lesser Buffer size
    options.roomId = this.roomCount++
    options.roomName = roomName

    try {
      // Room#requestJoin may fail on constructor
      room = new handler(utils.merge(clientOptions, options))

      room.on('lock', this.lockRoom.bind(this, roomName, room))
      room.on('unlock', this.unlockRoom.bind(this, roomName, room))
      room.once('dispose', this.disposeRoom.bind(this, roomName, room))

      // room always start unlocked
      this.unlockRoom(roomName, room)

    } catch (e) {
      room = null
    }

    return room
  }

  lockRoom (roomName, room) {
    if (this.hasAvailableRoom(roomName)) {
      let index = this.availableRooms[roomName].indexOf(room);
      if (index !== -1) {
        utils.spliceOne(this.availableRooms[roomName], index)
      }
    }
  }

  unlockRoom (roomName, room) {
    if (this.availableRooms[ roomName ].indexOf(room) === -1) {
      this.availableRooms[ roomName ].push(room)
    }
  }

  disposeRoom(roomName, room) {
    // remove from available rooms
    this.lockRoom(roomName, room)

    // remove from active matches
    let index = this.activeMatches.indexOf(room)
    if (index !== -1) {
      utils.spliceOne(this.activeMatches, index)
    }

  }

}

module.exports = MatchMaker

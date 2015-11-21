var utils = require('./utils')

class MatchMaker {

  constructor () {
    this.handlers = {}
    this.availableRooms = {}
    this.activeMatches = []
  }

  addHandler (name, handler) {
    this.handlers[ name ] = handler
    this.availableRooms[ name ] = []
  }

  hasHandler (roomName) {
    return this.handlers[ roomName ]
  }

  hasAvailableRoom (roomName) {
    return (this.availableRooms[ roomName ] &&
      this.availableRooms[ roomName ].length > 0)
  }

  joinOrCreate (client, roomName, options) {
    var room = null

    if (this.hasAvailableRoom(roomName)) {
      room = this.requestJoin(client, roomName, options)
      console.log("Join", roomName, "?", room)
    }

    if (!room) {
      console.log("Let's create", roomName)
      room = this.create(client, roomName, options)
    }

    return room
  }

  requestJoin (client, roomName, options) {
    for (var i=0; i<this.availableRooms[ roomName ].length; i++) {
      let availableRoom = this.availableRooms[ roomName ][i]
      if (availableRoom.requestJoin(options)) {
        return availableRoom
      }
    }
    return false
  }

  create (client, roomName, options) {
    var room = null
      , handler = this.handlers[ roomName ]

    if (handler && handler.isValidOptions(options)) {
      room = new handler(options)
      room.once('dispose', this.disposeRoom.bind(this, room))
      this.availableRooms[ roomName ].push(room)
    }

    return room
  }

  disposeRoom(room) {
    var roomName = room.constructor.name;

    // remove from available rooms
    if (this.hasAvailableRoom(roomName)) {
      let index = this.availableRooms[roomName].indexOf(room);
      if (index !== -1) {
        utils.spliceOne(this.availableRooms[roomName], index)
      }
    }

    // remove from active matches
    let index = this.activeMatches.indexOf(room)
    if (index !== -1) {
      utils.spliceOne(this.activeMatches, index)
    }

    console.log("this.activeMatches", this.activeMatches)
    console.log("this.availableRooms", this.availableRooms)
  }

}

module.exports = MatchMaker

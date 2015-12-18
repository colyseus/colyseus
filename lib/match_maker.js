"use strict";

var utils = require('./utils')
  , env = require('./environment')

class MatchMaker {

  constructor () {
    this.handlers = {}

    this.availableRooms = {}
    this.roomsById = {}

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

  joinById (client, roomId, clientOptions) {
    let room = this.roomsById[ roomId ]
    if (!room) { throw new Error(`room doesn't exists`) }

    if (!room.requestJoin(clientOptions)) {
      throw new Error(`Can't join ${ options.roomName }`)
    }
    room._onJoin(client, clientOptions)

    return room
  }

  joinOrCreateByName (client, roomName, clientOptions) {
    // throw error
    if (!this.hasHandler(roomName)) {
      throw new Error(`no handler for "${ roomName }"`);
    }

    let room = (this.requestJoin(client, roomName, clientOptions) || this.create(client, roomName, clientOptions))

    if (room) {
      room._onJoin(client, clientOptions)
    }

    return room
  }

  requestJoin (client, roomName, clientOptions) {
    var room = false;

    if (this.hasAvailableRoom(roomName)) {
      for (var i=0; i<this.availableRooms[ roomName ].length; i++) {
        let availableRoom = this.availableRooms[ roomName ][i]
        if (availableRoom.requestJoin(clientOptions)) {
          room = availableRoom
          break
        }
      }
    }

    return room
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

      this.roomsById[ room.roomId ] = room

      // room always start unlocked
      this.unlockRoom(roomName, room)

    } catch (e) {
      if (env.current !== env.TEST) {
        console.log(e.stack)
      }
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
    delete this.roomsById[ room.roomId ]

    // remove from available rooms
    this.lockRoom(roomName, room)
  }

}

module.exports = MatchMaker

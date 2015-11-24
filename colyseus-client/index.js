var WebSocketClient = require('websocket.js')
  , msgpack = require('msgpack-lite')
  , jsonpatch = require('fast-json-patch')
  , protocol = require('./protocol')
  , Room = require('./lib/Room')

class Colyseus extends WebSocketClient {

  constructor (url, protocols = null, options = {}) {
    super(url, protocols, options)
    this.binaryType = "arraybuffer"

    this.roomStates = {}
    this.rooms = {}
  }

  send (data) {
    return super.send( msgpack.encode(data) )
  }

  join (roomName, options) {
    this.rooms[ roomName ] = new Room(roomName)
    this.send([protocol.JOIN_ROOM, roomName, options || {}])
    return this.rooms[ roomName ]
  }

  leave (roomNameOrId) {
    if (typeof(roomNameOrId)!=="number" && this.rooms[ roomNameOrId ]) {
      roomNameOrId = this.rooms[ roomNameOrId ]
    }
    this.send([protocol.LEAVE_ROOM, roomName])
  }

  /**
   * @override
   */
  onMessageCallback (event) {
    var message = msgpack.decode( new Uint8Array(event.data) )

    if (typeof(message[0]) === "number") {
      let roomId = message[1]

      if (message[0] == protocol.USER_ID) {
        this.id = message[1]
        return true

      } else if (message[0] == protocol.ROOM_STATE) {
        let roomState = message[3]

        // first room message received, keep associated only with roomId
        this.rooms[ roomId ] = this.rooms[ message[2] ]
        this.rooms[ roomId ].state = roomState
        this.rooms[ roomId ].emit('setup', this.rooms[ roomId ].state)
        delete this.rooms[ message[2] ]

        this.rooms[ roomId ].roomId = roomId
        this.roomStates[ roomId ] = roomState

        return true

      } else if (message[0] == protocol.ROOM_STATE_PATCH) {
        this.rooms[ roomId ].emit('patch', message[2])
        jsonpatch.apply(this.roomStates[ roomId ], message[2])
        this.rooms[ roomId ].emit('update', this.roomStates[ roomId ])

        return true

      } else if (message[0] == protocol.ROOM_DATA) {
        this.rooms[ roomId ].emit('data', message[2])
        message = [ message[2] ]
      }
    }

    if (this.listeners['onmessage']) this.listeners['onmessage'].apply(null, message)
  }

}

module.exports = Colyseus

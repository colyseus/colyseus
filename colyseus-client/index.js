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
    this._enqueuedCalls = []
  }

  onOpenCallback (event) {
    if (this._enqueuedCalls.length > 0) {
      for (var i=0; i<this._enqueuedCalls.length; i++) {
        let [ method, args ] = this._enqueuedCalls[i]
        this[ method ].apply(this, args)
      }
    }
  }

  send (data) {
    return super.send( msgpack.encode(data) )
  }

  join (roomName, options) {
    if (this.ws.readyState == WebSocket.OPEN) {
      this.send([protocol.JOIN_ROOM, roomName, options || {}])

    } else {
      // WebSocket not connected.
      // Enqueue it to be called when readyState == OPEN
      this._enqueuedCalls.push(['join', arguments])
    }

    if (!this.rooms[ roomName ]) {
      this.rooms[ roomName ] = new Room(this, roomName)
    }

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
        if (this.listeners['onopen']) this.listeners['onopen'].apply(null)
        return true

      } else if (message[0] == protocol.JOIN_ROOM) {
        // first room message received, keep association only with roomId
        this.rooms[ roomId ] = this.rooms[ message[2] ]
        this.rooms[ roomId ].roomId = roomId
        this.rooms[ roomId ].emit('join')
        // delete this.rooms[ message[2] ]
        return true

      } else if (message[0] == protocol.JOIN_ERROR) {
        this.rooms[ roomId ].emit('error', message[2])
        delete this.rooms[ roomId ]
        return true

      } else if (message[0] == protocol.LEAVE_ROOM) {
        this.rooms[ roomId ].emit('leave')
        return true

      } else if (message[0] == protocol.ROOM_STATE) {
        let roomState = message[2]

        this.rooms[ roomId ].state = roomState
        this.rooms[ roomId ].emit('setup', this.rooms[ roomId ].state)

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

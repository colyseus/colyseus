var WebSocketServer = require('ws').Server

  , shortid = require('shortid')
  , msgpack = require('msgpack-lite')

  , protocol = require('./protocol')
  , MatchMaker = require('./match_maker')

class Server {

  constructor (options) {
    this.server = new WebSocketServer(options)
    this.server.on('connection', this.onConnect.bind(this))

    this.clients = {}
    this.roomsByClient = {}

    this.matchMaker = new MatchMaker()
  }

  room (handler) {
    this.matchMaker.addHandler(handler.name, handler)

    // // matchmaking options
    // if (matchmake) {  }
  }

  onConnect (client) {
    client.id = shortid.generate()
    console.log(`${client.id} connected`)

    client.on('message', this.onMessage.bind(this, client));
    client.on('close', this.onDisconnect.bind(this, client));

    this.clients[ client.id ] = client
    this.roomsByClient[ client.id ] = []
  }

  onMessage (client, data) {
    let message = msgpack.decode(data)

    if (typeof(message[0]) === "number" && message[0] == protocol.JOIN_ROOM) {
      this.onJoinRoomRequest(client, message[1], message[2])
    } else {
      this.roomsByClient[ client.id ].forEach(room => room.onMessage(client, data))
    }
  }

  onJoinRoomRequest (client, roomName, options) {
    var room = false, error = null

    if (!this.matchMaker.hasHandler(roomName)) {
      error = `no handler for "${roomName}"`

    } else {
      room = this.matchMaker.joinOrCreate(client, roomName, options);
    }

    if (room) {
      room._onJoin(client)
      this.roomsByClient[ client.id ].push( room )
    } else {
      client.send(msgpack.encode([protocol.BAD_REQUEST, error || "invalid options"]))
    }
  }

  onDisconnect (client) {
    // send leave message to all connected rooms
    this.roomsByClient[ client.id ].forEach(room => room._onLeave(client))

    delete this.clients[ client.id ]
    delete this.roomsByClient[ client.id ]
  }

}

module.exports = Server

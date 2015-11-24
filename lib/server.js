var WebSocketServer = require('ws').Server

  , shortid = require('shortid')
  , msgpack = require('msgpack-lite')

  , protocol = require('./protocol')
  , MatchMaker = require('./match_maker')

// // memory debugging
// setInterval(function() { console.log(require('util').inspect(process.memoryUsage())); }, 1000)

class Server {

  constructor (options) {
    this.server = new WebSocketServer(options)
    this.server.on('connection', this.onConnect.bind(this))

    // room references by client id
    this.clients = {}

    this.matchMaker = new MatchMaker()
  }

  /**
   * @example Registering with a class reference
   *    server.register(RoomHandler)
   *
   * @example Registering with room name + class handler
   *    server.register("room_name", RoomHandler)
   *
   * @example Registering with room name + class handler + custom options
   *    server.register("area_1", AreaHandler, { map_file: "area1.json" })
   *    server.register("area_2", AreaHandler, { map_file: "area2.json" })
   *    server.register("area_3", AreaHandler, { map_file: "area3.json" })
   *
   * @param name
   * @param handler
   * @param options
   */
  register (name, handler, options) {
    if (typeof(name)!=="string" && name.name) {
      handler = name
      name = handler.name
    }
    this.matchMaker.addHandler(name, handler, options)
  }

  onConnect (client) {
    client.id = shortid.generate()
    client.send( msgpack.encode([protocol.USER_ID, client.id]), { binary: true } )

    client.on('message', this.onMessage.bind(this, client));
    client.on('close', this.onDisconnect.bind(this, client));

    this.clients[ client.id ] = []

    console.log(`${client.id} connected`)
  }

  onMessage (client, data) {
    let message = msgpack.decode(data)

    if (typeof(message[0]) === "number" && message[0] == protocol.JOIN_ROOM) {
      this.onJoinRoomRequest(client, message[1], message[2])
    } else {
      this.clients[ client.id ].forEach(room => room._onMessage(client, message))
    }
  }

  onJoinRoomRequest (client, roomName, clientOptions) {
    var room = false, error = null

    if (!this.matchMaker.hasHandler(roomName)) {
      error = `no handler for "${roomName}"`

    } else {
      room = this.matchMaker.joinOrCreate(client, roomName, clientOptions || {});
    }

    if (room) {
      room._onJoin(client)
      this.clients[ client.id ].push( room )
    } else {
      client.send(msgpack.encode([protocol.BAD_REQUEST, error || "invalid options"]), { binary: true })
    }
  }

  onDisconnect (client) {
    // send leave message to all connected rooms
    this.clients[ client.id ].forEach(room => room._onLeave(client))
    delete this.clients[ client.id ]
  }

}

module.exports = Server

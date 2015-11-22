var Room = require('../../lib/room')

class ChatRoom extends Room {

  constructor (options) {
    super(options)
    console.log("Construct ChatRoom")
  }

  onJoin (client) {
    console.log("ChatRoom:", client.id, "connected")
  }

  onLeave (client) {
    console.log("ChatRoom:", client.id, "disconnected")
  }

  onMessage (client, data) {
    // TODO
    // - When sending messages, it would be good to flag which handler is interested in them.
    // - add 'onMatchStart' method, which can be used to store common data

    if (data.message == "kick") {
      this.clients.filter(c => c.id !== client.id).forEach(other => other.close())
    }

    console.log("ChatRoom:", client.id, data)
  }

  update () {
    console.log(`ChatRoom ~> Update: ${ this.clients.length }`)
  }

  dispose () {
    console.log("Dispose ChatRoom")
  }

}

ChatRoom.updateInterval = 200

module.exports = ChatRoom

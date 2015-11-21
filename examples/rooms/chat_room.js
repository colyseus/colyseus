var Room = require('../../lib/room')

class ChatRoom extends Room {

  constructor (options) {
    super(options)
    console.log("Construct ChatRoom")
  }

  onJoin (client) {
    console.log(client.id, "connected into ChatRoom")
  }

  onLeave (client) {
    console.log(client.id, "disconnected from ChatRoom")
  }

  onMessage (client, data) {
    if (data.message == "kick") {
      this.clients.filter(c => c.id !== client.id).forEach(other => other.close())
    }

    console.log(client.id, "send a message: ", data)
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

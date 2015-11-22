var Room = require('../../lib/room')

class ChatRoom extends Room {

  constructor (options) {
    super(options)

    this.state.messages = []

    console.log("ChatRoom created!", options)
  }

  onJoin (client) {
    // console.log("ChatRoom:", client.id, "connected")
  }

  onLeave (client) {
    // console.log("ChatRoom:", client.id, "disconnected")
  }

  onMessage (client, data) {
    // TODO
    // - When sending messages, it would be good to flag which handler is interested in them.
    if (data.message == "kick") {
      this.clients.filter(c => c.id !== client.id).forEach(other => other.close())

    } else {
      this.state.messages.push(data.message)
    }

    console.log("ChatRoom:", client.id, data)
  }

  update () {
    this.broadcast()
  }

  dispose () {
    console.log("Dispose ChatRoom")
  }

}

ChatRoom.updateInterval = 1000

module.exports = ChatRoom

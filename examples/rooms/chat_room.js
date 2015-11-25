var Room = require('../../lib/room')

class ChatRoom extends Room {

  constructor (options) {
    options.updateInterval = 1000
    super(options, { messages: [] })
    console.log("ChatRoom created!", options)
  }

  onJoin (client) {
    this.sendState(client)
    console.log("ChatRoom:", client.id, "connected")
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

module.exports = ChatRoom

var Room = require('../../lib/room')

class ChatRoom extends Room {

  constructor (options) {
    super(options, 1000)

    this.setState({ messages: [] })

    console.log("ChatRoom created!", options)
  }

  onJoin (client) {
    this.sendState(client)
    this.state.messages.push(`${ client.id } joined.`)
  }

  onLeave (client) {
    this.state.messages.push(`${ client.id } leaved.`)
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

  dispose () {
    console.log("Dispose ChatRoom")
  }

}

module.exports = ChatRoom

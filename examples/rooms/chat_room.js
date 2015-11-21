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
    console.log(client.id, "send a message: ", data)
  }

  update () {
    console.log(`ChatRoom ~> Update: ${ this.state.clients }`)
  }

  dispose () {
    console.log("Dispose ChatRoom")
  }

}

ChatRoom.updateInterval = 200

module.exports = ChatRoom

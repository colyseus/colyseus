"use strict";

var Room = require('../../lib/Room').Room;

class ChatRoom extends Room {

  constructor ( options ) {

    super( options )

    this.useTimeline()

    this.setPatchRate( 1000 )

    this.setState({ messages: [] })

    console.log("ChatRoom created!", options)

  }

  onJoin (client) {
    this.state.messages.push(`${ client.id } joined.`)
  }

  onLeave (client) {
    this.state.messages.push(`${ client.id } leaved.`)
  }

  onMessage (client, data) {
    if (data.message == "kick") {
      this.clients.filter(c => c.id !== client.id).forEach(other => other.close())

    } else {
      this.state.messages.push(data.message)
    }

    console.log("ChatRoom:", client.id, data)
  }

  onDispose () {
    console.log("Dispose ChatRoom")
  }

}

module.exports = ChatRoom

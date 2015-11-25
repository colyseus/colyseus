var Room = require('../../lib/room')

class BattleRoom extends Room {

  constructor (options) {
    options.updateInterval = 1100
    super(options)
    console.log("BattleRoom created!", options)
  }

  onJoin (client) {
    if (this.clients.length == 4) {
      this.lock()
      console.log("BattleRoom is now locked!")
    }
    // console.log("BattleRoom:", client.id, "connected")
  }

  onLeave (client) {
    // console.log("BattleRoom:", client.id, "disconnected")
  }

  onMessage (client, data) {
    // console.log("BattleRoom:", client.id, data)
  }

  update () {
    // console.log(`BattleRoom ~> Update: ${ this.clients.length }`)
  }

  dispose () {
    console.log("Dispose BattleRoom")
  }

}

module.exports = BattleRoom

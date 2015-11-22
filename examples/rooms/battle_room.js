var Room = require('../../lib/room')

class BattleRoom extends Room {

  constructor (options) {
    super(options)
    console.log("BattleRoom created!", options)
    console.log("Construct BattleRoom")
  }

  onJoin (client) {
    console.log("BattleRoom:", client.id, "connected")
  }

  onLeave (client) {
    console.log("BattleRoom:", client.id, "disconnected")
  }

  onMessage (client, data) {
    console.log("BattleRoom:", client.id, data)
  }

  update () {
    console.log(`BattleRoom ~> Update: ${ this.clients.length }`)
  }

  dispose () {
    console.log("Dispose BattleRoom")
  }

}

BattleRoom.updateInterval = 400

module.exports = BattleRoom

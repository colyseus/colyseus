// Room state, with list of GameObjects

class RoomState {

  constructor () {
    this.clients = 0
    this.gameObjects = []
  }

  // TODO: sync data / gameobjects
  sync () { }

}

module.exports = RoomState

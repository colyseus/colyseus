var jsonpatch = require('fast-json-patch')

class StateObserver {

  constructor (state) {
    this.state = state

    if (typeof(state.toJSON)!=="function") {
      this.patchObserver = jsonpatch.observe(state)
    } else {
      this.previousState = this.toJSON(this.state)
    }
  }

  getLastState () {
    return this.previousState || this.state
  }

  getPatches () {
    if (this.patchObserver) {
      return jsonpatch.generate(this.patchObserver)

    } else {
      var newState = this.toJSON(this.state)
        , diff = jsonpatch.compare(this.previousState, newState)

      this.previousState = newState

      return diff
    }
  }

  toJSON(obj) {
    var result

    if (obj && typeof(obj.toJSON)==="function") {
      result = obj.toJSON()

      for (var k in result) {
        result[k] = this.toJSON(result[k])
      }

    } else if (obj instanceof Array) {
      result = obj.map((_) => this.toJSON(_))

    } else {
      result = obj
    }

    return result
  }

}

module.exports = StateObserver

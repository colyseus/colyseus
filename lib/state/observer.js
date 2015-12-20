var jsonpatch = require('fast-json-patch')

class StateObserver {

  constructor (state) {
    this.state = state

    if (typeof(state.toJSON)!=="function") {
      this.patchObserver = jsonpatch.observe(state)

    } else {
      this.previousState = JSON.parse(JSON.stringify(this.toJSON(this.state)))
      this.patchObserver = jsonpatch.observe(this.previousState)
    }
  }

  getLastState () {
    return this.previousState || this.state
  }

  getPatches () {
    if (!this.previousState) {
      return jsonpatch.generate(this.patchObserver)

    } else {
      Object.assign(this.previousState, this.toJSON(this.state))
      return jsonpatch.generate(this.patchObserver)
    }
  }

  toJSON(obj) {
    //
    // TODO: there is possibly room for improvement on this method
    //
    // You can see the impact of changes on this benchmark:
    // `node --harmony test/benchmark/patch.js`
    //
    var result

    if (obj && typeof(obj.toJSON)==="function") {
      result = obj.toJSON()

    } else if (obj instanceof Array) {
      result = obj.map((_) => this.toJSON(_))

    } else {
      result = obj
    }

    if (typeof(result)==="object") {
      for (var k in result) {
        result[k] = this.toJSON(result[k])
      }
    }

    return result
  }

}

module.exports = StateObserver

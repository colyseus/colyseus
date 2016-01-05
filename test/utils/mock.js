"use strict";

var shortid = require('shortid')
  , EventEmitter = require('events').EventEmitter

class Client extends EventEmitter {
  constructor (id) {
    super()
    this.id = id || null
    this.messages = []
  }
  send (message) { this.messages.push(message) }
  close () { this.emit('close') }
}

module.exports.createEmptyClient = function () {
  return new Client()
}

module.exports.createDummyClient = function () {
  return new Client(shortid.generate())
}

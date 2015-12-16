var shortid = require('shortid')

module.exports.createDummyClient = function () {
  return {
    messages: [],
    id: shortid.generate(),
    send: function(message) { this.messages.push(message) }
  }
}

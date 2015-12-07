var shortid = require('shortid')

module.exports.createDummyClient = function () {
  return {
    id: shortid.generate(),
    send: function() {  }
  }
}

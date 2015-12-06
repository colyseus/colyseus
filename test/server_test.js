var assert = require('assert')
  , Server = require('../lib/server.js')

describe('Server', function() {
  var server = new Server({port: 1111})

  before(function() {
    // ...
  });

  describe('#indexOf()', function() {
    it('should return -1 when not present', function() {
      assert.equal([1,2,3].indexOf(4), -1);
    });
  });
});

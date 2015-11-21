var mocha = require('mocha')
  , describe = mocha.describe
  , before = mocha.before
  , it = mocha.it
  , assert = require('assert')

  , Server = require('../lib/server.js')

describe('Server', function() {
  var server = new Server()

  before(function() {
    // ...
  });

  describe('#indexOf()', function() {
    it('should return -1 when not present', function() {
      assert.equal([1,2,3].indexOf(4), -1);
    });
  });
});

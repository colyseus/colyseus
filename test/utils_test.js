var mocha = require('mocha')
  , describe = mocha.describe
  , before = mocha.before
  , it = mocha.it
  , assert = require('assert')

  , utils = require('../lib/utils.js')

describe('utils', function() {
  describe('#diff', function() {
    it('should return basic diff', function() {
      console.log(utils.diff([], [1]))
      console.log(utils.diff([1,2,3], [1,2,3,4]))
    });
  });
});


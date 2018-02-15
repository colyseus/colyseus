import * as assert from "assert";
import * as colyseus from "../src";

describe('Module', function() {
  describe('should expose Clock', function() {
      assert.ok(colyseus.Clock)
  })

  describe('should expose generateId', function() {
      assert.ok(colyseus.generateId);
  })

  describe('should expose @noync', function() {
    assert.ok(colyseus.nosync);
  })
});

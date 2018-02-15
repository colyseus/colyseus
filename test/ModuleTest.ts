import * as assert from "assert";
import * as colyseus from "../src";

describe('Module', function() {
  describe('should expose Clock and Delayed', function() {
      assert.ok(colyseus.Clock)
      assert.ok(colyseus.Delayed)
  })

  describe('should expose generateId', function() {
      assert.ok(colyseus.generateId);
  })

  describe('should expose @noync', function() {
    assert.ok(colyseus.nosync);
  })
});

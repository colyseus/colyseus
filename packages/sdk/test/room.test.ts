import './util';
import { describe, test } from "vitest";
import { assert } from "chai";
import { Room } from "../src/index.ts";

describe("Room", function() {
  let room: Room = null;

  describe("onMessage / dispatchMessage", () => {
      test("* should handle if message is not registered", () => new Promise<void>((done) => {
          room = new Room("chat");

          room.onMessage("*", (type, message) => {
              assert.equal("something", type);
              assert.equal(1, message);
              done();
          });

          room.onMessage("type", (message) => assert.equal(5, message));

          room['dispatchMessage']("type", 5);
          room['dispatchMessage']("something", 1);
      }));

      test("should handle string message types", () => new Promise<void>((done) => {
          room = new Room("chat");
          room.onMessage("type", (message) => {
              assert.equal(5, message);
              done();
          });
          room['dispatchMessage']("type", 5);
      }));

      test("should handle number message types", () => new Promise<void>((done) => {
          room = new Room("chat");
          room.onMessage(0, (message) => {
              assert.equal(5, message);
              done();
          });
          room['dispatchMessage'](0, 5);
      }));

      test("should handle number message types", () => new Promise<void>((done) => {
          room = new Room("chat");
          room.onMessage(0, (message) => {
              assert.equal(5, message);
              done();
          });
          room['dispatchMessage'](0, 5);
      }));

  });

});

import assert from "assert";
import { Client, Room, SchemaSerializer } from "@colyseus/core";
import { Schema } from "@colyseus/schema";
import { WebSocketClient } from "./utils";
import sinon from "sinon";

describe("Room", () => {
  class State extends Schema { }
  class MyRoom extends Room {
    onCreate() { this.setState(new State()); }
    onMessage() { }
  }

  describe("SchemaSerializer", () => {

    it("setState() should select correct serializer", () => {
      const room = new MyRoom()
      room.onCreate();

      assert.ok(room['_serializer'] instanceof SchemaSerializer);
    });

  });


  describe("autoDispose", () => {
    it("autoDispose setter should reset the autoDispose timeout", () => {
      const room = new MyRoom();

      // @ts-ignore
      const resetAutoDisposeTimeoutSpy = sinon.spy(room, 'resetAutoDisposeTimeout');

      room.autoDispose = false;
      room.autoDispose = true;

      sinon.assert.callCount(resetAutoDisposeTimeoutSpy, 2);
    });
  });

});
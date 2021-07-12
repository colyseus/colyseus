import assert from "assert";
import { Room, SchemaSerializer } from "@colyseus/core";
import { Schema } from "@colyseus/schema";

describe("Room", () => {

  describe("SchemaSerializer", () => {
    class State extends Schema {}
    class MyRoom extends Room {
      onCreate() { this.setState(new State()); }
      onMessage() {}
    }

    it("setState() should select correct serializer", () => {
      const room = new MyRoom()
      room.onCreate();

      assert.ok(room['_serializer'] instanceof SchemaSerializer);
    });

  });

});
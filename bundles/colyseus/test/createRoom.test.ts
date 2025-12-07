import assert from "assert";
import { createRoom, Room, type Client } from "@colyseus/core";

describe("createRoom()", () => {
  type MyClient = Client<{
    messages: {
      foo: { foo: string };
    };
  }>;

  const obj = {
    method() {},
    other() {
      this.method();
    }
  }

  const MyRoom = createRoom<{ client: MyClient }>({
    messages: {
      foo (client, message: { foo: string }) {
      }
    },
    onCreate() {
      this.customMethod();
    },
    onJoin(client, options) {
      client.send("foo", { foo: "bar" });
    },
    onLeave() {
    },
    onDispose() {
    },
    customMethod() {
    }
  });

  it("room created by createRoom() should extend Room", () => {
    const room = new MyRoom();
    assert.ok(room instanceof Room);
  });
});
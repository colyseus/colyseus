import assert from "assert";
import { defineRoom, Room, type Client } from "@colyseus/core";

describe("Room: Type Inference", () => {

  describe("using class-based Rooms (class MyRoom extends Room { ... })", () => {
    // Define a typed client with specific message types
    type MyClient = Client<{
      messages: {
        nopayload: never;
        message_any: any;
        obj_message: { message: string };
        optional_message: { value: number } | undefined;
      };
    }>;

    // Test client.send() type checking directly
    function testClientSend(client: MyClient) {
      client.send("obj_message", { message: "hello" });
      client.send("nopayload");

      // Valid: message with 'any' type accepts anything
      client.send("message_any", { anything: true });
      client.send("message_any", "string");
      client.send("message_any", 123);
      client.send("message_any", undefined);
      client.send("message_any");

      // Valid: message with optional payload (union with undefined)
      client.send("optional_message", { value: 42 });
      client.send("optional_message", undefined);
      client.send("optional_message");

      // Invalid: undefined message type
      // @ts-expect-error - "wtf" is not a defined message type
      client.send("wtf", {});

      // Invalid: wrong payload type (empty object missing required 'message' key)
      // @ts-expect-error - {} is not assignable to { message: string }
      client.send("obj_message", {});

      // Invalid: undefined when payload is required
      // @ts-expect-error - undefined is not assignable to { message: string }
      client.send("obj_message", undefined);

      // Invalid: missing required payload for send
      // @ts-expect-error - obj_message requires a message payload
      client.send("obj_message");

      // Invalid: wrong payload structure
      // @ts-expect-error - { wrong: string } is not assignable to { message: string }
      client.send("obj_message", { wrong: "key" });
    }

    // Test that untyped Client remains backwards compatible
    function testUntypedClientSend(client: Client) {
      // Untyped client should accept any message type (backwards compatibility)
      client.send("any_message", { anything: true });
      client.send("another", 123);
      client.send("no_payload");
    }

    // Test Room.broadcast() with typed client inferred from generic parameter
    class MyRoom extends Room<{ client: MyClient }> {
      onJoin(client: MyClient, options: any) {
        client.send("obj_message", { message: "hello" });
        client.send("nopayload");
        client.send("message_any", { anything: true });
        client.send("optional_message", { value: 42 });
        client.send("optional_message");

        // @ts-expect-error - "unknown_type" is not defined
        client.send("unknown_type", {});

        // @ts-expect-error - wrong payload
        client.send("obj_message", { wrong: "key" });

        // @ts-expect-error - missing required payload
        client.send("obj_message");

        // @ts-expect-error - undefined when payload is required
        client.send("obj_message", undefined);

        this.broadcast("obj_message", { message: "hello" });
        this.broadcast("nopayload");
        this.broadcast("message_any", { anything: true });
        this.broadcast("message_any");
        this.broadcast("optional_message", { value: 42 });
        this.broadcast("optional_message");

        // @ts-expect-error - "wtf" is not a defined message type
        this.broadcast("wtf", {});

        // @ts-expect-error - "dummy" is not a defined message type
        this.broadcast("dummy", {});

        // @ts-expect-error - wrong payload type (empty object missing required 'message' key)
        this.broadcast("obj_message", {});

        // @ts-expect-error - missing required payload for broadcast
        this.broadcast("obj_message");

        // @ts-expect-error - undefined when payload is required
        this.broadcast("obj_message", undefined);

        // @ts-expect-error - wrong payload structure
        this.broadcast("obj_message", { wrong: "key" });
      }

      onCreate() {
        // Test wildcard handler - dynamic type forwarding requires type assertion
        this.onMessage("*", (client, type, message) => {
          // @ts-expect-error - 'string | number' is not assignable to keyof messages
          this.broadcast(type, message);
        });

        // Test undefined message type in onMessage handler
        this.onMessage("dummy", (client, message) => {
          // @ts-expect-error - "dummy" is not a defined message type
          this.broadcast("dummy", message);
        });
      }
    }

    // Test untyped Room (backwards compatibility)
    class UntypedRoom extends Room {
      onJoin(client: Client, options: any) {
        // Untyped client/room should accept any message type
        client.send("anything", { works: true });
        this.broadcast("anything", { also: "works" });
      }
    }

    it("type definitions should compile correctly", () => {
      assert.ok((new MyRoom()) instanceof Room);
      assert.ok((new UntypedRoom()) instanceof Room);
    });
  });

});

import assert from "assert";
import { Room, type Client } from "@colyseus/core";
import { Room as SDKRoom } from "@colyseus/sdk";
import { schema, t, type SchemaType } from "@colyseus/schema";

/**
 * Compile-time assertions for request/response type inference. The response
 * type a client awaits is derived from the *return type* of the matching
 * server `messages` handler (see `ExtractResponseType`).
 */
describe("Request/Response: Type Inference", () => {
  const RequestState = schema({ count: t.number() });
  type RequestState = SchemaType<typeof RequestState>;

  class RequestRoom extends Room<{ state: RequestState }> {
    state = new RequestState();

    messages = {
      "sum": (_client: Client, message: { a: number; b: number }) => ({ result: message.a + message.b }),
      "ping": (_client: Client) => "pong" as const,
      "fetch": async (_client: Client, id: string) => ({ id, name: "n" }),
    };
  }

  // type-only: never actually invoked at runtime
  function _assertClientTyping(room: SDKRoom<RequestRoom>) {
    // request() resolves to the handler's (awaited) return type
    room.request("sum", { a: 1, b: 2 }).then((res) => {
      const result: number = res.result;
      void result;
    });
    room.request("ping").then((res) => {
      const pong: "pong" = res;
      void pong;
    });
    // async handler return is unwrapped through Awaited
    room.request("fetch", "abc").then((res) => {
      const name: string = res.name;
      void name;
    });

    // send(type, payload, callback) ack receives the same response type
    room.send("sum", { a: 1, b: 2 }, (res) => {
      const result: number = res.result;
      void result;
    });

    // @ts-expect-error - "unknown" is not a defined message type
    room.request("unknown", {});

    // @ts-expect-error - wrong payload shape for "sum"
    room.request("sum", { a: "x", b: 2 });
  }

  it("request/response types compile correctly", () => {
    assert.ok(typeof _assertClientTyping === "function");
  });
});

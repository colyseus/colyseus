import assert from "assert";

import { defineServer } from "@colyseus/core";
import { uWebSocketsTransport } from "@colyseus/uwebsockets-transport";

const TEST_PORT = 8582;

/**
 * handleUnmatchedRequest() lets a subclass serve the HTTP requests no Colyseus
 * route matched, with the uWS request untouched.
 */
describe("Transport: uWebSockets.js: handleUnmatchedRequest()", () => {
  let server: ReturnType<typeof defineServer>;

  class CustomTransport extends uWebSocketsTransport {
    protected handleUnmatchedRequest(res: any, req: any) {
      if (req.getUrl() !== "/custom") {
        return false;
      }
      // the method as the client sent it: nothing lowercased it before
      const answer = `${req.getCaseSensitiveMethod()} ${req.getUrl()}`;
      res.cork(() => res.end(answer));
      return true;
    }
  }

  before(async () => {
    server = defineServer({ greet: false, transport: new CustomTransport(), rooms: {} });
    await server.listen(TEST_PORT);
  });

  after(async () => {
    await server.gracefullyShutdown(false);
  });

  it("should hand an unmatched request to the subclass", async () => {
    const res = await fetch(`http://127.0.0.1:${TEST_PORT}/custom`, { method: "POST" });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(await res.text(), "POST /custom");
  });

  it("should keep the Colyseus routes first", async () => {
    const res = await fetch(`http://127.0.0.1:${TEST_PORT}/__healthcheck`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(await res.text(), "OK");
  });
});

import assert from "assert";

import * as ColyseusSDK from "@colyseus/sdk";
import { Deferred, Room, Server, defineServer, matchMaker, parseLatencyEnv, setDevMode } from "@colyseus/core";

const TEST_PORT = 8579;
const TEST_ENDPOINT = `ws://localhost:${TEST_PORT}`;

const TOLERANCE = 5; // setTimeout can fire a hair early under load

async function measureRoundTrip(roomName: string) {
  const client = new ColyseusSDK.Client(TEST_ENDPOINT);
  const running = new Deferred();

  let receivedOnServerAt = 0;
  let receivedOnClientAt = 0;

  matchMaker.defineRoomType(roomName, class _ extends Room {
    onCreate() {
      this.onMessage("request", (c) => {
        receivedOnServerAt = Date.now();
        c.send("response", "");
      });
    }
  });

  const connection = await client.joinOrCreate(roomName);
  connection.onMessage("response", () => {
    receivedOnClientAt = Date.now();
    running.resolve(true);
  });

  const startedAt = Date.now();
  connection.send("request", "");
  await running;
  await connection.leave();

  return {
    request: receivedOnServerAt - startedAt,
    response: receivedOnClientAt - receivedOnServerAt,
  };
}

describe("simulateLatency before listen", () => {

  it("can be called before listen()", async () => {
    const LATENCY = 300;
    const HALF_LATENCY = LATENCY / 2;

    // no `transport` option: the default one resolves asynchronously
    const server = new Server({ greet: false, gracefullyShutdown: false });
    server.simulateLatency(LATENCY);

    await server.listen(TEST_PORT);
    try {
      const elapsed = await measureRoundTrip("latency_before_listen");
      assert.ok(elapsed.request >= HALF_LATENCY - TOLERANCE, `outgoing latency should be at least ${HALF_LATENCY}ms, got: ${elapsed.request}ms`);
      assert.ok(elapsed.response >= HALF_LATENCY - TOLERANCE, `incoming latency should be at least ${HALF_LATENCY}ms, got: ${elapsed.response}ms`);
    } finally {
      server.simulateLatency(0);
      await server.gracefullyShutdown(false);
    }
  });

  it("COLYSEUS_LATENCY overrides calls made before boot", async () => {
    const LATENCY = 30;
    const HALF_LATENCY = LATENCY / 2;

    process.env.COLYSEUS_LATENCY = String(LATENCY);

    const server = new Server({ greet: false, gracefullyShutdown: false });
    server.simulateLatency(500); // the env var must win over this

    try {
      await server.listen(TEST_PORT);
      const elapsed = await measureRoundTrip("latency_env_var");
      assert.ok(elapsed.request >= HALF_LATENCY - TOLERANCE, `outgoing latency should be at least ${HALF_LATENCY}ms, got: ${elapsed.request}ms`);
      assert.ok(elapsed.request < 150, `the 500ms code call should have been overridden, got: ${elapsed.request}ms`);
      assert.ok(elapsed.response < 150, `the 500ms code call should have been overridden, got: ${elapsed.response}ms`);
    } finally {
      delete process.env.COLYSEUS_LATENCY;
      server.simulateLatency(0);
      await server.gracefullyShutdown(false);
    }
  });

  it("defineServer() dev-mode object exposes simulateLatency()", () => {
    setDevMode(true);
    try {
      const server = defineServer({ rooms: {} });
      assert.strictEqual(typeof server.simulateLatency, "function");
      // no transport registered by the vite plugin here — must not throw
      server.simulateLatency(30);
      server.simulateLatency(0); // restore Room.prototype for later tests
    } finally {
      setDevMode(false);
    }
  });

  describe("parseLatencyEnv", () => {
    afterEach(() => { delete process.env.COLYSEUS_LATENCY; });

    it("parses COLYSEUS_LATENCY", () => {
      process.env.COLYSEUS_LATENCY = "500";
      assert.strictEqual(parseLatencyEnv(), 500);
      process.env.COLYSEUS_LATENCY = "0";
      assert.strictEqual(parseLatencyEnv(), 0);
    });

    it("returns undefined when absent or invalid", () => {
      delete process.env.COLYSEUS_LATENCY;
      assert.strictEqual(parseLatencyEnv(), undefined);
      process.env.COLYSEUS_LATENCY = "";
      assert.strictEqual(parseLatencyEnv(), undefined);
      process.env.COLYSEUS_LATENCY = "abc";
      assert.strictEqual(parseLatencyEnv(), undefined);
    });
  });

});

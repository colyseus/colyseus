import assert from "assert";

import { defineRoom, defineServer, matchMaker, Room, setDevMode, Server, unregisterRoomDefinitions } from "@colyseus/core";
import { setTransport } from "@colyseus/core/Transport";
import { reloadColyseusViteRooms } from "colyseus/vite";

/**
 * Under `colyseus/vite` the plugin owns the transport, the matchmaker and the
 * HTTP server — but user code is still written against the documented `Server`
 * API. https://github.com/colyseus/colyseus/issues/956
 */
describe("defineServer() in dev mode", () => {
  beforeEach(() => setDevMode(true));
  afterEach(() => setDevMode(false));

  it("is a real Server, so the whole documented API is present", () => {
    assert.ok(defineServer({ rooms: {} }) instanceof Server);
  });

  it("listen() resolves without binding a port", async () => {
    const server = defineServer({ rooms: {} });
    let listening = false;

    await server.listen(2567, undefined, undefined, () => listening = true);

    assert.strictEqual(listening, true);
  });

  it("runs onBeforeShutdown/onShutdown on gracefullyShutdown()", async () => {
    const server = defineServer({ rooms: {} });
    const calls: string[] = [];

    server.onBeforeShutdown(() => { calls.push("before"); });
    server.onShutdown(() => { calls.push("after"); });

    await matchMaker.setup();
    await server.gracefullyShutdown(false);

    assert.deepStrictEqual(calls, ["before", "after"]);
  });

  it("adopts the transport the plugin registered before importing user code", () => {
    const transport = { simulateLatency() {}, shutdown() {} } as any;
    setTransport(transport);

    try {
      assert.strictEqual(defineServer({ rooms: {} }).transport, transport);
    } finally {
      setTransport(undefined as any);
    }
  });

  it("hands the room definitions back to the plugin instead of registering them", () => {
    const rooms = {} as any;
    const server = defineServer({ rooms });

    assert.strictEqual(server["~rooms"], rooms);
  });

  // the non-Vite docs spell it `const gameServer = defineServer(...)`, which
  // exports nothing the plugin looks for
  it("registers rooms from an entry that never exported its server", async () => {
    const entry = async () => {
      defineServer({ rooms: { pullowar: defineRoom(class extends Room {}) } });
      return {}; // module body ran, but exported no `server` and no `rooms`
    };

    const { roomNames, hasRooms } = await reloadColyseusViteRooms(entry, "entry.ts");

    try {
      assert.strictEqual(hasRooms, true);
      assert.deepStrictEqual(roomNames, ["pullowar"]);
    } finally {
      unregisterRoomDefinitions(roomNames);
    }
  });
});

import assert from "assert";

import { createEndpoint, defineRoom, defineServer, matchMaker, Room, setDevMode, Server, unregisterRoomDefinitions } from "@colyseus/core";
import { setTransport } from "@colyseus/core/Transport";
import { prepareServices } from "@colyseus/core/internal";
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

/**
 * The plugin never calls `listen()`, so it has to run the service boot itself
 * — otherwise `beforeListen`, `database.boot()` and the endpoints they
 * contribute never happen under `colyseus/vite`.
 */
describe("prepareServices() in dev mode", () => {
  beforeEach(() => setDevMode(true));
  afterEach(() => setDevMode(false));

  it("runs beforeListen and boots the database", async () => {
    const calls: string[] = [];
    const server = defineServer({
      rooms: {},
      beforeListen: () => { calls.push("beforeListen"); },
      database: { boot: async () => { calls.push("boot"); } },
    });

    await prepareServices(server, true);

    assert.deepStrictEqual(calls, ["beforeListen", "boot"]);
  });

  // the server listens once, so re-booting after a reload must not re-run it
  it("skips beforeListen when the host is already started", async () => {
    let ran = 0;
    const server = defineServer({ rooms: {}, beforeListen: () => { ran++; } });

    await prepareServices(server, false);

    assert.strictEqual(ran, 0);
  });

  it("lets the database contribute endpoints to the router", async () => {
    const server = defineServer({
      rooms: {},
      database: {
        boot: async () => {},
        applyRouterDefaults: async (router) => router.extend({
          whoami: createEndpoint("/whoami", { method: "GET" }, async () => ({ ok: true })),
        }),
      },
    });

    const router = await prepareServices(server, true);

    assert.ok(router.endpoints.whoami, "database endpoints should be mounted");
  });

  // HMR re-evaluates user code, so each reload hands over a fresh database
  // instance that has never been booted
  it("boots the fresh database a reload hands over", async () => {
    const booted: string[] = [];
    const reload = (name: string) => defineServer({
      rooms: {},
      database: { boot: async () => { booted.push(name); } },
    });

    await prepareServices(reload("first"), true);
    await prepareServices(reload("second"), false);

    assert.deepStrictEqual(booted, ["first", "second"]);
  });
});

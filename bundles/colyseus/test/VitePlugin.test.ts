import assert from "assert";
import fs from "fs";
import http from "http";
import type { Plugin, ViteDevServer } from "vite";

import { Deferred, matchMaker, Server, setDevMode, unregisterRoomDefinitions } from "@colyseus/core";
import { MatchMakerState } from "@colyseus/core/MatchMaker";
import { setTransport } from "@colyseus/core/Transport";
import { colyseus, type ColyseusViteOptions } from "colyseus/vite";

const ROOM_NAME = "vite_fixture_room";
const SERVER_ENTRY = "/fixtures/vite-server-entry.ts";

const httpServer = http.createServer();

const fakeWsTransport = {
  WebSocketTransport: class { attachToServer() { } },
} as any;

/**
 * A plugin that brings its own environment factory (nitro, cloudflare) leaves
 * the colyseus environment without a `runner` — only a `RunnableDevEnvironment`
 * has one. https://github.com/colyseus/colyseus/pull/967
 */
const foreignEnvironmentFactory: Plugin = {
  name: "test:environment-without-runner",
  config: () => ({
    environments: {
      colyseus: {
        dev: {
          createEnvironment: async (name, config, context) => {
            const { DevEnvironment } = await import("vite");
            return new DevEnvironment(name, config, { ...context, hot: false });
          },
        },
      },
    },
  }),
};

// imported here, not at module scope: mocha loads every spec file up front, so
// a static import would put vite in the process for the whole suite
async function startDevServer(plugins: Plugin[] = [], options: Partial<ColyseusViteOptions> = {}) {
  const { createServer } = await import("vite");

  return createServer({
    configFile: false,
    root: import.meta.dirname,
    logLevel: "silent",
    server: { middlewareMode: true },
    plugins: [
      ...plugins,
      colyseus({
        serverEntry: SERVER_ENTRY,
        httpServer,
        loadWsTransport: async () => fakeWsTransport,
        quiet: true,
        ...options,
      }),
    ],
  });
}

// Vite fires the plugin's post-`configureServer` hook without awaiting it, so
// the entry is still loading when createServer() resolves.
async function waitFor(condition: () => unknown, what: string) {
  for (let i = 0; i < 1000; i++) {
    if (condition()) { return; }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`timed out waiting for ${what}`);
}

const roomHandler = () => matchMaker.getAllHandlers()[ROOM_NAME];

// a real HTTP round trip through the dev server's middleware stack
async function request(vite: ViteDevServer, path: string, init?: RequestInit) {
  const server = http.createServer(vite.middlewares);
  await new Promise<void>((resolve) => server.listen(0, resolve));

  try {
    const { port } = server.address() as { port: number };
    const response = await fetch(`http://localhost:${port}${path}`, init);
    return { status: response.status, body: await response.text() };

  } finally {
    server.close();
  }
}

describe("colyseus() vite plugin", () => {
  let vite: ViteDevServer;

  afterEach(async () => {
    await vite?.close();
    setTransport(undefined as any);

    // before the shutdown: in dev mode it would cache room history to disk
    setDevMode(false);

    // best-effort: a failing load leaves the matchMaker half set up, and its
    // error would mask the assertion that actually failed
    await matchMaker.gracefullyShutdown().catch(() => { });

    // after the shutdown: disposing a room looks up its handler
    unregisterRoomDefinitions([ROOM_NAME]);
  });

  it("loads the server entry", async () => {
    vite = await startDevServer();

    await waitFor(roomHandler, `room "${ROOM_NAME}"`);
  });

  it("loads the server entry from an environment with no runner", async () => {
    vite = await startDevServer([foreignEnvironmentFactory]);

    const { isRunnableDevEnvironment } = await import("vite");
    assert.strictEqual(isRunnableDevEnvironment(vite.environments.colyseus), false);
    await waitFor(roomHandler, `room "${ROOM_NAME}"`);
  });

  // the entry is re-imported through the same runner, so its evaluated module
  // cache has to be cleared rather than the runner replaced or closed
  it("reloads the server entry from an environment with no runner", async () => {
    vite = await startDevServer([foreignEnvironmentFactory]);
    await waitFor(roomHandler, `room "${ROOM_NAME}"`);

    const previous = roomHandler();
    vite.watcher.emit("change", `${import.meta.dirname}${SERVER_ENTRY}`);

    // a reload re-registers the rooms and then hot-reloads the running ones —
    // waiting only for the rooms would leave hotReload() in flight, and its
    // disconnectAll() would land in whatever test runs next
    await waitFor(() => matchMaker.state === MatchMakerState.SHUTTING_DOWN, "the reload to start");
    await waitFor(() => matchMaker.state === MatchMakerState.READY, "the reload to finish");

    assert.notStrictEqual(roomHandler(), previous);
  });

  // the reload shuts down the database the previous evaluation opened, which
  // an express app built only once would still be using
  it("rebuilds the express app on reload", async () => {
    const entry = "/fixtures/vite-express-entry.ts";
    vite = await startDevServer([], { serverEntry: entry });
    await waitFor(roomHandler, `room "${ROOM_NAME}"`);

    const firstDatabase: any = Server.current!.options.database;
    vite.watcher.emit("change", `${import.meta.dirname}${entry}`);
    await waitFor(() => firstDatabase.closed, "the reload to shut down the first database");

    const { status, body } = await request(vite, "/database");

    assert.strictEqual(status, 200, body);
    assert.deepStrictEqual(JSON.parse(body), { closed: false });
  });

  //
  // See: https://github.com/colyseus/colyseus/issues/996
  //
  describe("matchmaking while the server entry loads", () => {
    const joinOrCreate = () => request(vite, `/matchmake/joinOrCreate/${ROOM_NAME}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });

    it("waits for the rooms to be defined at startup", async () => {
      const loaded = new Deferred<void>();

      // holds the load open, as a slow top-level await in the entry would
      vite = await startDevServer([], {
        loadWsTransport: async () => { await loaded; return fakeWsTransport; },
      });

      const pending = joinOrCreate();
      setTimeout(() => loaded.resolve(), 100);
      const { status, body } = await pending;

      assert.strictEqual(status, 200, body);
      assert.ok(JSON.parse(body).sessionId);
    });

    it("waits for a reload to finish cycling the rooms", async () => {
      vite = await startDevServer();
      await waitFor(() => matchMaker.state === MatchMakerState.READY, "the entry to load");

      vite.watcher.emit("change", `${import.meta.dirname}${SERVER_ENTRY}`);
      await waitFor(() => matchMaker.state === MatchMakerState.SHUTTING_DOWN, "the reload to start");

      const { status, body } = await joinOrCreate();

      assert.strictEqual(status, 200, body);
    });
  });
});

describe("colyseus() vite plugin: production build", () => {
  const root = `${import.meta.dirname}/fixtures/vite-app`;
  const PORT = 8591;
  const url = (path: string) => `http://localhost:${PORT}${path}`;

  after(async () => {
    await Server.current?.transport?.shutdown();
    unregisterRoomDefinitions(["vite_build_room"]);
    await matchMaker.gracefullyShutdown().catch(() => { });
    fs.rmSync(`${root}/dist`, { recursive: true, force: true });
  });

  // listen() runs the user's `express` callback, so a SPA fallback registered
  // before it answered every GET route the user defined
  it("serveClient does not shadow express routes", async () => {
    const { createBuilder } = await import("vite");
    const builder = await createBuilder({
      configFile: false,
      root,
      logLevel: "silent",
      plugins: [colyseus({ serverEntry: "/server.ts", serveClient: true, port: PORT })],
    });
    await builder.buildApp();

    await import(`${root}/dist/server/server.mjs`);

    // the entry doesn't await listen()
    let listening = false;
    for (let i = 0; i < 200 && !listening; i++) {
      listening = await fetch(url("/__healthcheck")).then((res) => res.ok, () => false);
      if (!listening) { await new Promise((resolve) => setTimeout(resolve, 10)); }
    }
    assert.ok(listening, "built server never started listening");

    assert.strictEqual(await (await fetch(url("/hello"))).text(), "hello from express");
    assert.match(await (await fetch(url("/"))).text(), /vite-app client/);
    assert.match(await (await fetch(url("/some/client/route"))).text(), /vite-app client/);
  });
});

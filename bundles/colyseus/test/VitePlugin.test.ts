import assert from "assert";
import http from "http";
import type { Plugin, ViteDevServer } from "vite";

import { matchMaker, setDevMode, unregisterRoomDefinitions } from "@colyseus/core";
import { MatchMakerState } from "@colyseus/core/MatchMaker";
import { setTransport } from "@colyseus/core/Transport";
import { colyseus } from "colyseus/vite";

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
async function startDevServer(plugins: Plugin[] = []) {
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

describe("colyseus() vite plugin", () => {
  let vite: ViteDevServer;

  afterEach(async () => {
    await vite?.close();
    unregisterRoomDefinitions([ROOM_NAME]);
    setTransport(undefined as any);

    // before the shutdown: in dev mode it would cache room history to disk
    setDevMode(false);

    // best-effort: a failing load leaves the matchMaker half set up, and its
    // error would mask the assertion that actually failed
    await matchMaker.gracefullyShutdown().catch(() => { });
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
});

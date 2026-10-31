/**
 * A real server process on default options. The rest of the suite runs in-process
 * with `gracefullyShutdown: false`, where an error reaching `uncaughtException`
 * doesn't stop the server, so it can't tell whether one would.
 */
import assert from "assert";
import { spawn, type ChildProcess } from "child_process";
import { Client as SDKClient, type Room as SDKRoom } from "@colyseus/sdk";
import { timeout } from "./utils/index.ts";

const TEST_PORT = 8582;
const LOBBY_FILTER = { name: "faulty", metadata: { mode: "duel" } };

describe("Server process", () => {
  let child: ChildProcess;
  let client: SDKClient;

  beforeEach(async () => {
    child = spawn(process.execPath, [`${import.meta.dirname}/fixtures/default-options-server.mjs`], {
      env: {
        ...process.env,
        PORT: String(TEST_PORT),
        // importing @pm2/io installs an `unhandledRejection` handler, which would
        // hide an escaped rejection; it skips that under cluster mode
        exec_mode: "cluster_mode",
      },
      stdio: ["ignore", "pipe", "ignore"],
    });

    await new Promise<void>((resolve, reject) => {
      child.stdout.on("data", (data) => {
        if (data.toString().includes("listening")) { resolve(); }
      });
      child.once("exit", (code) => reject(new Error(`server exited on boot (code ${code})`)));
    });

    client = new SDKClient(`http://localhost:${TEST_PORT}`);
  });

  afterEach(async () => {
    if (child.exitCode === null) {
      const exited = new Promise((resolve) => child.once("exit", resolve));
      child.kill("SIGKILL");
      await exited;
    }
  });

  async function assertStillServing(...rooms: SDKRoom[]) {
    await timeout(200);
    assert.strictEqual(child.exitCode, null, "server process has exited");

    const room = await client.create("faulty");
    await Promise.all([room, ...rooms].map((r) => r.leave()));
  }

  it("a throwing onMessage handler should not stop it", async () => {
    const room = await client.create("faulty");
    room.send("sync");
    await assertStillServing(room);
  });

  it("a rejected onMessage handler should not stop it", async () => {
    const room = await client.create("faulty");
    room.send("async");
    await assertStillServing(room);
  });

  it("a lobby metadata filter over a room without metadata should not stop it", async () => {
    const room = await client.create("faulty");

    const lobby = await client.joinOrCreate("lobby");
    lobby.onMessage("*", () => {});
    lobby.send("filter", LOBBY_FILTER);

    await assertStillServing(room, lobby);
  });

  it("a lobby update for a room without metadata should not stop it", async () => {
    const lobby = await client.joinOrCreate("lobby", { filter: LOBBY_FILTER });
    lobby.onMessage("*", () => {});

    const room = await client.create("faulty");

    await assertStillServing(room, lobby);
  });
});

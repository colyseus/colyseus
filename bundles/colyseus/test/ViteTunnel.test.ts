import assert from "assert";
import path from "path";

import { guard } from "../src/vite-tunnel.ts";

const ROOT = path.join(import.meta.dirname, "app");
/** `/@fs` + an absolute path, as Vite writes it: `/@fs/C:/...` on Windows. */
const FS = "/@fs" + (ROOT.startsWith("/") ? "" : "/") + ROOT.replaceAll("\\", "/");

/** The status `guard` answers `url` on `host` with, or "next" when it lets it through. */
function statusOf(url: string, host = "game.play.colyseus.dev", entry = "/src/server/index.ts") {
  let status: number | string = "next";
  const res = { statusCode: 200, end: () => { status = res.statusCode; } };
  guard(ROOT, entry, ".play.colyseus.dev")({ url, headers: { host } }, res, () => {});
  return status;
}

describe("Vite plugin: tunnel", () => {
  it("keeps tunnelled requests out of the server entry's folder", () => {
    assert.strictEqual(statusOf("/src/server/index.ts"), 404);
    assert.strictEqual(statusOf("/src/server/rooms/Lobby.ts?import"), 404);
    assert.strictEqual(statusOf("/src/%73erver/secret.ts"), 404);
    assert.strictEqual(statusOf("/src/client/../server/secret.ts"), 404);
    assert.strictEqual(statusOf(`${FS}/src/server/secret.ts`), 404);
    assert.strictEqual(statusOf(`/@id/${FS.slice("/@fs/".length)}/src/server/secret.ts`), 404);
  });

  it("lets the rest through, and every local request", () => {
    assert.strictEqual(statusOf("/src/main.ts"), "next");
    assert.strictEqual(statusOf("/src/serverless.ts"), "next");
    assert.strictEqual(statusOf("/matchmake/joinOrCreate/lobby"), "next");
    assert.strictEqual(statusOf("/src/server/index.ts", "localhost:5173"), "next");
    assert.strictEqual(statusOf("/src/server/index.ts", "play.colyseus.dev.evil.com"), "next");
  });

  it("protects only the entry when it sits at the root", () => {
    assert.strictEqual(statusOf("/server.ts", undefined, "/server.ts"), 404);
    assert.strictEqual(statusOf("/src/main.ts", undefined, "/server.ts"), "next");
  });
});

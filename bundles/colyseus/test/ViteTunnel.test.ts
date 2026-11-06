import assert from "assert";
import path from "path";

import { guard, tunnelPlugin } from "../src/vite-tunnel.ts";

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

  it("keeps the project's configuration out of reach, a monorepo's too", () => {
    const parent = FS.slice(0, FS.lastIndexOf("/"));
    for (const url of ["/package.json", "/pnpm-lock.yaml", "/vite.config.ts?import", "/tsconfig.app.json", "/Dockerfile", `${FS}/package.json`, `${parent}/pnpm-workspace.yaml`, `${parent}/package.json`]) {
      assert.strictEqual(statusOf(url), 404, url);
    }
    // what the page itself may load from the root, or a config module of its own
    for (const url of ["/main.js", "/style.css", "/src/app.config.ts", "/node_modules/react/package.json"]) {
      assert.strictEqual(statusOf(url), "next", url);
    }
    assert.strictEqual(statusOf("/package.json", "localhost:5173"), "next");
  });

  it("adds s + enter, hinted under Vite's own hint", async () => {
    const lines: string[] = [];
    let bound: any;
    const server: any = {
      config: { root: ROOT, logger: { info: (line: string) => lines.push(line.replace(/\x1b\[\d+m/g, "")) } },
      middlewares: { use: () => {} },
      httpServer: { once: () => {} },
      bindCLIShortcuts: (options: any) => { bound = options; },
    };
    await (tunnelPlugin(true, "/src/server/index.ts")[0].configureServer as any)(server);

    const tty = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
    const ci = process.env.CI;
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    delete process.env.CI;
    try {
      server.bindCLIShortcuts({ print: true, customShortcuts: [{ key: "x", description: "theirs" }] });
      assert.deepStrictEqual(bound.customShortcuts.map((s: any) => s.key), ["x", "s"]);
      assert.deepStrictEqual(lines, ["  ➜  press s + enter to share on a public URL (*.play.colyseus.dev)"]);
      assert.strictEqual(bound.customShortcuts[1].description, "share on a public URL (*.play.colyseus.dev)");

      // a rebind without print (Vite's restart) adds no second hint
      server.bindCLIShortcuts({});
      assert.strictEqual(lines.length, 1);
    } finally {
      if (tty) { Object.defineProperty(process.stdin, "isTTY", tty); } else { delete (process.stdin as any).isTTY; }
      if (ci !== undefined) { process.env.CI = ci; }
    }
  });

  it("protects only the entry when it sits at the root", () => {
    assert.strictEqual(statusOf("/server.ts", undefined, "/server.ts"), 404);
    assert.strictEqual(statusOf("/src/main.ts", undefined, "/server.ts"), "next");
  });
});

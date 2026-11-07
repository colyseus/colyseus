import assert from "assert";
import fs from "fs";
import http from "http";
import os from "os";
import path from "path";

import { guard, tunnelPlugin, type GuardOptions } from "../src/vite-tunnel.ts";

/** A project on disk: what a page loads, what it doesn't, and the server. */
const ROOT = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "vite-tunnel-")));
const FILES = [
  "index.html", "favicon.svg", "img/hero.png", "notes.txt", ".devmode.json", "package.json", "vite.config.ts", "main.js", "counter.js", "style.css",
  "src/client/main.ts", "src/client/assets/model.glb", "src/client/worker.ts", "src/client/keys.json", "src/client/token", "src/client/notes.txt", "src/shared/util.ts",
  "data/levels.json", "data/sprite.png",
  "src/server/index.ts", "src/server/rooms/Lobby.ts",
  "data/jwt-secret", "data/sa.json", "scripts/deploy.sh",
  "public/logo.png", "node_modules/.vite/deps/chunk-A.js", "node_modules/pkg/index.js",
];
const SIBLING = ROOT + "-shared"; // a monorepo package beside the root
for (const f of FILES) {
  fs.mkdirSync(path.dirname(path.join(ROOT, f)), { recursive: true });
  fs.writeFileSync(path.join(ROOT, f), "x");
}
fs.writeFileSync(path.join(ROOT, "index.html"), `<link rel="icon" href="/favicon.svg"><img src=./img/hero.png><script type="module" src="/src/client/main.ts"></script><a href="https://example.com/x">`);
fs.mkdirSync(SIBLING, { recursive: true });
fs.writeFileSync(path.join(SIBLING, "ui.ts"), "x");
fs.writeFileSync(path.join(SIBLING, "secret"), "x");

const at = (...files: string[]) => files.map((f) => path.isAbsolute(f) ? f : path.join(ROOT, f));
/** `/@fs` + an absolute path, as Vite writes it: `/@fs/C:/...` on Windows. */
const fsUrl = (file: string) => "/@fs" + (file.startsWith("/") ? "" : "/") + file.replaceAll("\\", "/");
const FS = fsUrl(ROOT);

/** A graph of `imported` files (each with an importer), and `direct` ones fetched by URL alone. */
const graphOf = (imported: string[], direct: string[] = []) => new Map([
  ...at(...imported).map((f) => [f, [{ importers: new Set([1]) }]] as const),
  ...at(...direct).map((f) => [f, [{ importers: new Set() }]] as const),
]);

/** A guard over ROOT whose page has imported `modules`. */
function guardOf(modules: string[] = [], extra: Partial<GuardOptions> = {}, direct: string[] = []) {
  const graph = graphOf(modules, direct);
  const kept: string[] = [];
  const handle = guard({
    root: ROOT, serverEntry: "/src/server/index.ts", hostSuffix: ".play.colyseus.dev",
    publicDir: path.join(ROOT, "public"), cacheDir: path.join(ROOT, "node_modules/.vite"),
    pageFiles: () => graph, refused: (p) => kept.push(p), ...extra,
  });
  /** The status it answers `url` on `host` with, or "next" when it lets it through. */
  const statusOf = (url: string, host = "game.play.colyseus.dev", accept = "*/*") => new Promise<number | string>((resolve) => {
    const res = { statusCode: 200, end: () => resolve(res.statusCode) };
    handle({ url, headers: { host, accept } }, res, () => resolve("next"));
  });
  return { statusOf, graph, kept };
}

async function statuses(statusOf: (url: string) => Promise<number | string>, urls: string[]) {
  return Object.fromEntries(await Promise.all(urls.map(async (u) => [u, await statusOf(u)])));
}
const all = (urls: string[], status: number | string) => Object.fromEntries(urls.map((u) => [u, status]));

describe("Vite plugin: tunnel", () => {
  after(() => {
    fs.rmSync(ROOT, { recursive: true, force: true });
    fs.rmSync(SIBLING, { recursive: true, force: true });
  });

  it("keeps tunnelled requests out of the server entry's folder", async () => {
    const { statusOf } = guardOf(["src/client/main.ts", "src/server/index.ts"]);
    const urls = [
      "/src/server/index.ts", "/src/server/rooms/Lobby.ts?import", "/src/%73erver/index.ts", "/src/client/../server/index.ts",
      "/src/server/index", `${FS}/src/server/index.ts`, `/@id/${FS.slice("/@fs/".length)}/src/server/index.ts`, "/src/server/missing.ts",
    ];
    assert.deepStrictEqual(await statuses(statusOf, urls), all(urls, 404));
  });

  it("keeps out what the resolver turns a URL into", async () => {
    // Vite resolves extensionless and aliased URLs to files: `/@/server/index` with `@` for src/
    const resolve = async (url: string) => url.startsWith("/@/") ? path.join(ROOT, "src", url.slice(3)) + ".ts" : undefined;
    const { statusOf } = guardOf(["src/client/main.ts"], { resolve });
    assert.strictEqual(await statusOf("/@/server/index"), 404);
    assert.strictEqual(await statusOf("/@/client/main"), "next");
  });

  it("serves what the page loads: its modules, their folders, public/, pages, dependencies", async () => {
    const { statusOf } = guardOf(["src/client/main.ts", "src/shared/util.ts", "node_modules/pkg/index.js"]);
    const urls = [
      "/", "/index.html", "/src/client/main.ts?import", "/src/client/assets/model.glb", "/src/shared/util.ts",
      "/public/logo.png", "/node_modules/.vite/deps/chunk-A.js?v=1", "/node_modules/pkg/index.js",
    ];
    assert.deepStrictEqual(await statuses(statusOf, urls), all(urls, "next"));
  });

  it("lets through what names no file: routes, Vite's own URLs, the page fallback", async () => {
    const { statusOf } = guardOf();
    const urls = ["/matchmake/joinOrCreate/lobby", "/@vite/client", "/@id/__x00__virtual:x", "/some/route", "/logo.png", "/data/"];
    assert.deepStrictEqual(await statuses(statusOf, urls), all(urls, "next"));
  });

  it("keeps out the files the page never loads, and says so once", async () => {
    const { statusOf, kept } = guardOf(["src/client/main.ts"]);
    const urls = ["/data/jwt-secret", "/data/sa.json", "/scripts/deploy.sh", "/notes.txt", "/.devmode.json", "/main.js", "/src/client/../../data/jwt-secret", "/data/jwt%2Dsecret"];
    assert.deepStrictEqual(await statuses(statusOf, urls), all(urls, 404));
    await statusOf("/data/jwt-secret");
    assert.deepStrictEqual(kept.sort(), ["/.devmode.json", "/data/jwt-secret", "/data/sa.json", "/main.js", "/notes.txt", "/scripts/deploy.sh"]);
  });

  it("serves what an .html page names before Vite records it", async () => {
    const { statusOf } = guardOf();
    assert.strictEqual(await statusOf("/src/client/main.ts"), 404);
    assert.strictEqual(await statusOf("/", "game.play.colyseus.dev", "text/html"), "next");
    for (const url of ["/src/client/main.ts", "/favicon.svg", "/img/hero.png"]) {
      assert.strictEqual(await statusOf(url), "next", url);
    }
    assert.strictEqual(await statusOf("/data/jwt-secret"), 404);
  });

  it("opens the root's own assets and code to a module there, never its folders", async () => {
    // Vite's vanilla template: main.js at the root imports ./counter.js
    const { statusOf } = guardOf(["counter.js"]);
    for (const url of ["/counter.js", "/main.js", "/style.css", "/favicon.svg"]) { assert.strictEqual(await statusOf(url), "next", url); }
    for (const url of ["/notes.txt", "/.devmode.json", "/data/jwt-secret", "/package.json", "/vite.config.ts"]) { assert.strictEqual(await statusOf(url), 404, url); }
  });

  it("serves a folder's assets and code by URL, never its data", async () => {
    const { statusOf } = guardOf(["src/client/main.ts"]);
    for (const url of ["/src/client/assets/model.glb", "/src/client/worker.ts?worker_file&type=module"]) { assert.strictEqual(await statusOf(url), "next", url); }
    for (const url of ["/src/client/keys.json", "/src/client/token", "/src/client/notes.txt"]) { assert.strictEqual(await statusOf(url), 404, url); }
    // imported data is the page's, and opens its folder's assets alone
    const imported = guardOf(["src/client/main.ts", "data/levels.json"]).statusOf;
    for (const url of ["/data/levels.json", "/data/sprite.png"]) { assert.strictEqual(await imported(url), "next", url); }
    for (const url of ["/data/jwt-secret", "/data/sa.json"]) { assert.strictEqual(await imported(url), 404, url); }
  });

  it("doesn't count a file fetched directly as the page's", async () => {
    // Vite records any file it transforms, a secret fetched on localhost included
    const { statusOf } = guardOf(["src/client/main.ts"], {}, ["data/jwt-secret", "scripts/deploy.sh", "index.html"]);
    for (const url of ["/data/jwt-secret", "/data/sa.json", "/scripts/deploy.sh", "/notes.txt"]) { assert.strictEqual(await statusOf(url), 404, url); }
  });

  it("keeps the project's configuration out, unless the page imports it", async () => {
    const parent = FS.slice(0, FS.lastIndexOf("/"));
    const urls = ["/package.json", "/vite.config.ts?import", "/tsconfig.app.json", `${FS}/package.json`, `${parent}/pnpm-workspace.yaml`, `${parent}/package.json`];
    assert.deepStrictEqual(await statuses(guardOf(["src/client/main.ts"]).statusOf, urls), all(urls, 404));
    assert.strictEqual(await guardOf(["src/client/main.ts", "package.json"]).statusOf("/package.json"), "next");
  });

  it("serves a monorepo package's module and folder, not the folders above the root", async () => {
    fs.writeFileSync(path.join(SIBLING, "icon.svg"), "x");
    const { statusOf } = guardOf(["src/client/main.ts", path.join(SIBLING, "ui.ts")]);
    assert.strictEqual(await statusOf(fsUrl(path.join(SIBLING, "ui.ts"))), "next");
    // SIBLING sits beside ROOT: its folder's assets are the page's, as a linked package's are
    assert.strictEqual(await statusOf(fsUrl(path.join(SIBLING, "icon.svg"))), "next");
    assert.strictEqual(await statusOf(fsUrl(path.join(SIBLING, "secret"))), 404);
    assert.strictEqual(await statusOf(fsUrl(path.join(ROOT, "data/jwt-secret"))), 404);
    assert.strictEqual(await statusOf(fsUrl(path.join(os.tmpdir(), "nothing-here"))), "next");
  });

  it("compares a symlinked root by its real path", async () => {
    const link = ROOT + "-link";
    fs.symlinkSync(ROOT, link, "dir");
    try {
      const graph = graphOf(["src/client/main.ts"]);
      const handle = guard({ root: link, serverEntry: "/src/server/index.ts", hostSuffix: ".play.colyseus.dev", pageFiles: () => graph });
      const statusOf = (url: string) => new Promise((resolve) => {
        const res = { statusCode: 200, end: () => resolve(res.statusCode) };
        handle({ url, headers: { host: "game.play.colyseus.dev" } }, res, () => resolve("next"));
      });
      assert.strictEqual(await statusOf("/src/client/main.ts"), "next");
      assert.strictEqual(await statusOf("/src/server/index.ts"), 404);
      assert.strictEqual(await statusOf("/data/jwt-secret"), 404);
    } finally {
      fs.rmSync(link);
    }
  });

  it("keeps /__open-in-editor and every file under a base out too", async () => {
    const { statusOf } = guardOf(["src/client/main.ts"], { base: "/game/" });
    assert.strictEqual(await statusOf("/__open-in-editor?file=src/client/main.ts"), 404);
    assert.strictEqual(await statusOf("/game/__open-in-editor?file=x"), 404);
    assert.strictEqual(await statusOf("/game/data/jwt-secret"), 404);
    assert.strictEqual(await statusOf("/game/src/client/main.ts"), "next");
  });

  it("lets every local request through", async () => {
    const { statusOf } = guardOf();
    for (const url of ["/data/jwt-secret", "/src/server/index.ts", "/package.json", "/__open-in-editor?file=x"]) {
      assert.strictEqual(await statusOf(url, "localhost:5173"), "next", url);
      assert.strictEqual(await statusOf(url, "play.colyseus.dev.evil.com"), "next", url);
    }
  });

  it("adds s + enter, hinted under Vite's own hint", async () => {
    const lines: string[] = [];
    let bound: any;
    const server: any = {
      config: { root: ROOT, base: "/", build: {}, publicDir: "", cacheDir: "", logger: { info: (line: string) => lines.push(line.replace(/\x1b\[\d+m/g, "")) } },
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

  it("serves a real Vite dev server's page and keeps the rest out", async () => {
    const app = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "vite-tunnel-app-")));
    const write = (f: string, text: string) => {
      fs.mkdirSync(path.dirname(path.join(app, f)), { recursive: true });
      fs.writeFileSync(path.join(app, f), text);
    };
    write("index.html", `<script type="module" src="/src/client/main.ts"></script>`);
    write("src/client/main.ts", `import { n } from "./util.ts"; console.log(n, new URL("./assets/model.glb", import.meta.url));`);
    write("src/client/util.ts", "export const n = 1;");
    write("src/client/assets/model.glb", "glb");
    write("src/server/index.ts", "export const secret = 1;");
    write("data/jwt-secret", "secret");

    const { createServer } = await import("vite");
    const server = await createServer({
      configFile: false, root: app, logLevel: "silent",
      server: { port: 0, host: "127.0.0.1" },
      plugins: tunnelPlugin(true, "/src/server/index.ts"),
    });
    await server.listen();
    const { port } = server.httpServer!.address() as any;
    // fetch() drops a Host header; http.request sends it as given
    const get = (url: string, host = "game.play.colyseus.dev") => new Promise<number>((resolve, reject) => {
      http.get({ host: "127.0.0.1", port, path: url, headers: { host, accept: url === "/" ? "text/html" : "*/*" } }, (res) => {
        res.resume();
        resolve(res.statusCode!);
      }).on("error", reject);
    });
    try {
      // a local fetch puts the secret in Vite's graph: it must stay out all the same
      assert.strictEqual(await get("/data/jwt-secret", `127.0.0.1:${port}`), 200);
      // in the order a browser asks, each after the one that names it
      for (const url of ["/", "/src/client/main.ts", "/src/client/util.ts", "/src/client/assets/model.glb"]) {
        assert.strictEqual(await get(url), 200, url);
      }
      for (const url of ["/data/jwt-secret", "/src/server/index.ts", "/src/server/index", "/__open-in-editor?file=x"]) {
        assert.strictEqual(await get(url), 404, url);
      }
      assert.strictEqual(await get("/data/jwt-secret", `127.0.0.1:${port}`), 200);
    } finally {
      await server.close();
      fs.rmSync(app, { recursive: true, force: true });
    }
  });

  it("protects only the entry when it sits at the root", async () => {
    const { statusOf } = guardOf(["src/client/main.ts"], { serverEntry: "/main.js" });
    assert.strictEqual(await statusOf("/main.js"), 404);
    assert.strictEqual(await statusOf("/src/client/main.ts"), "next");
  });
});

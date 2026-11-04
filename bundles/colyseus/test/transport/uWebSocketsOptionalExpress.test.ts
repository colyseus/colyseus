import assert from "assert";
import { spawnSync } from "child_process";

/**
 * uwebsockets-express is an optional peer dependency: when it is not
 * installed, the transport must still start if no express app is used.
 */
describe("Transport: uWebSockets.js: without uwebsockets-express", () => {
  it("should start and shut down without the optional express layer", () => {
    // a resolve hook that makes the package missing, as when it is not installed
    const hooks = `export async function resolve(specifier, context, next) {
      if (specifier === "uwebsockets-express") {
        throw Object.assign(new Error("Cannot find package uwebsockets-express"), { code: "ERR_MODULE_NOT_FOUND" });
      }
      return next(specifier, context);
    }`;
    const register = `import { register } from "node:module"; register("data:text/javascript,${encodeURIComponent(hooks)}");`;
    // a handler of our own first: a dependency that catches every rejection (@pm2/io) would hide it
    const script = `
      process.on("unhandledRejection", (reason) => {
        console.error("unhandled rejection:", reason);
        process.exit(1);
      });
      const { defineServer } = await import("@colyseus/core");
      const { uWebSocketsTransport } = await import("@colyseus/uwebsockets-transport");
      const server = defineServer({ greet: false, transport: new uWebSocketsTransport(), rooms: {} });
      await server.listen(8581);
      setTimeout(async () => {
        await server.gracefullyShutdown(false);
        process.exit(0);
      }, 300);
    `;
    const run = spawnSync(process.execPath, [
      "--import", `data:text/javascript,${encodeURIComponent(register)}`,
      "--input-type=module", "-e", script,
    ], { cwd: process.cwd(), encoding: "utf8", timeout: 10000 });

    assert.strictEqual(run.status, 0, run.stderr);
  });
});

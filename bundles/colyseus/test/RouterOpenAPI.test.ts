/**
 * better-call auto-registers a public OpenAPI reference page ("/api/reference")
 * on every router unless disabled — an unauthenticated dump of the full API
 * surface. Colyseus disables it by default (the docs surface is playground's
 * gated /__apidocs); passing an explicit `openapi` config opts back in.
 *
 * The "user router" case also pins the extend regression: Server.bindRoutes()
 * merges getDefaultRouter().endpoints into the user's router, which used to
 * re-introduce the openapi endpoint even when the user had disabled it.
 */
import assert from "assert";
import { LocalPresence, LocalDriver, matchMaker, defineServer, defineRoom, createRouter, createEndpoint, Room } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";

class DummyRoom extends Room {
  onCreate() {}
}

const TEST_PORT = 8571;

async function boot(routes?: ReturnType<typeof createRouter>) {
  const server = defineServer({
    greet: false,
    gracefullyShutdown: false,
    presence: new LocalPresence(),
    driver: new LocalDriver(),
    transport: new WebSocketTransport(),
    rooms: { dummy: defineRoom(DummyRoom) },
    ...(routes ? { routes } : {}),
  });
  await matchMaker.setup(new LocalPresence(), new LocalDriver());
  await server.listen(TEST_PORT);
  return server;
}

describe("Router - /api/reference (OpenAPI page) is opt-in", () => {
  let server: ReturnType<typeof defineServer> | undefined;

  afterEach(async () => {
    if (server) {
      await server.gracefullyShutdown(false);
      server = undefined;
    }
  });

  it("default router does not serve /api/reference", async () => {
    server = await boot();
    const res = await fetch(`http://localhost:${TEST_PORT}/api/reference`);
    assert.strictEqual(res.status, 404);
  });

  it("user router does not serve /api/reference (even after default-routes extend)", async () => {
    server = await boot(createRouter({
      hello: createEndpoint("/hello", { method: "GET" }, async () => ({ ok: true })),
    }));
    const res = await fetch(`http://localhost:${TEST_PORT}/api/reference`);
    assert.strictEqual(res.status, 404);

    // sibling user routes unaffected
    const hello = await fetch(`http://localhost:${TEST_PORT}/hello`);
    assert.strictEqual(hello.status, 200);
  });

  it("explicit `openapi` config opts back in", async () => {
    server = await boot(createRouter({}, { openapi: {} }));
    const res = await fetch(`http://localhost:${TEST_PORT}/api/reference`);
    assert.strictEqual(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /text\/html/);
    assert.match(await res.text(), /matchmake/);
  });
});

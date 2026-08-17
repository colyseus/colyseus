import assert from "assert";
import { LocalPresence, matchMaker, Room, Server, type AuthContext, type BeforeUpgradeHandler } from "../../src/index.ts";
import { LocalDriver, createAuthContext, runBeforeUpgrade } from "@colyseus/core";

import { uWebSocketsTransport } from "@colyseus/uwebsockets-transport";
import { WebSocketTransport } from "@colyseus/ws-transport";

import WebSocket from "ws";

const TEST_PORT = 8571;
const TEST_ENDPOINT = `ws://localhost:${TEST_PORT}`;

/**
 * The handler is swapped per test, so a single server covers every case:
 * transports read `beforeUpgrade` once, at construction.
 */
let handler: BeforeUpgradeHandler = () => {};
const beforeUpgrade: BeforeUpgradeHandler = (request, context) => handler(request, context);

const TRANSPORTS = {
  "uWebSockets.js": () => new uWebSocketsTransport({ beforeUpgrade }),
  "ws": () => new WebSocketTransport({ beforeUpgrade }),
};

/**
 * Resolves with the HTTP response when the upgrade is refused, or `undefined`
 * once the WebSocket connection is established.
 */
function connect(path: string, requestHeaders?: Record<string, string>) {
  return new Promise<{ statusCode: number, headers: Record<string, any> } | undefined>((resolve, reject) => {
    const connection = new WebSocket(`${TEST_ENDPOINT}${path}`, { headers: requestHeaders });
    connection.on("open", () => { connection.close(); resolve(undefined); });
    connection.on("unexpected-response", (_, res) => resolve({ statusCode: res.statusCode!, headers: res.headers }));
    connection.on("error", reject);
  });
}

/** same as `connect()`, asserting the upgrade was refused */
async function connectRefused(path: string) {
  const response = await connect(path);
  assert.ok(response, "expected the upgrade to be refused");
  return response;
}

describe("beforeUpgrade: request", () => {
  it("should answer 400 without calling the handler when the Host header is not a valid authority", async () => {
    let called = false;
    const response = await runBeforeUpgrade(() => { called = true; }, "/process/room",
      createAuthContext({ headers: { host: "bad host" } }));

    assert.strictEqual(400, response!.status);
    assert.strictEqual(false, called);
  });

  it("should resolve the client address to a single address", () => {
    const resolve = (headers: Record<string, string>, remoteAddress?: string) =>
      createAuthContext({ headers, remoteAddress }).ip;

    assert.strictEqual("9.9.9.9", resolve({ "x-real-ip": "9.9.9.9", "x-forwarded-for": "1.2.3.4" }));
    assert.strictEqual("1.2.3.4", resolve({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" }));
    assert.strictEqual("1.2.3.4", resolve({ "x-client-ip": "1.2.3.4" }));
    assert.strictEqual("127.0.0.1", resolve({}, "127.0.0.1"));
    assert.strictEqual(undefined, resolve({}));
    assert.strictEqual("127.0.0.1", resolve({ "x-real-ip": "" }, "127.0.0.1"));
  });

  it("should join repeated headers, as an HTTP request would", async () => {
    let headers = new Headers();
    const context = createAuthContext({ headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" } });
    await runBeforeUpgrade((request) => { headers = request.headers; }, "/", context);

    assert.strictEqual("1.2.3.4, 5.6.7.8", headers.get("x-forwarded-for"));
  });
});

for (const [name, createTransport] of Object.entries(TRANSPORTS)) {
  describe(`beforeUpgrade: ${name}`, () => {
    let server: Server;

    before(async () => {
      const presence = new LocalPresence();
      const driver = new LocalDriver();

      server = new Server({ greet: false, presence, driver, transport: createTransport() });
      matchMaker.setup(presence, driver);
      matchMaker.defineRoomType("dummy", class _ extends Room {});

      await server.listen(TEST_PORT);
    });

    after(async () => {
      await matchMaker.gracefullyShutdown();
      server.transport.shutdown();
    });

    beforeEach(() => { handler = () => {}; });

    it("should upgrade after an async handler resolves", async () => {
      let receivedUrl = '';

      handler = async (request) => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        receivedUrl = request.url;
      };

      const reservation = await matchMaker.joinOrCreate("dummy", {});
      const path = `/${reservation.processId}/${reservation.roomId}?sessionId=${reservation.sessionId}`;

      assert.strictEqual(undefined, await connect(path));
      assert.strictEqual(`http://localhost:${TEST_PORT}${path}`, receivedUrl);
    });

    it("should expose the request headers", async () => {
      let headers = new Headers();
      handler = async (request) => { headers = request.headers; };

      await connect("/");

      assert.strictEqual(`localhost:${TEST_PORT}`, headers.get("host"));
      assert.strictEqual("websocket", headers.get("upgrade"));
      assert.ok(headers.get("sec-websocket-key"));
    });

    it("should receive the same context shape onAuth() gets", async () => {
      let context: Readonly<AuthContext> | undefined;
      handler = (_, ctx) => { context = ctx; };

      await connect("/p/room?sessionId=abc&_authToken=tok", { "x-real-ip": "9.9.9.9" });

      assert.ok(context, "expected the callback to run");
      assert.ok(context.headers instanceof Headers, "headers must be a Headers instance");
      assert.strictEqual(`localhost:${TEST_PORT}`, context.headers.get("host"));
      assert.strictEqual("tok", context.token);
      assert.strictEqual("9.9.9.9", context.ip);
    });

    it("should resolve the client address from x-forwarded-for", async () => {
      let ip: string | undefined;
      handler = (_, ctx) => { ip = ctx.ip; };

      await connect("/", { "x-forwarded-for": "1.2.3.4, 10.0.0.1, 10.0.0.2" });

      assert.strictEqual("1.2.3.4", ip);
    });

    it("should fall back to the peer address with no proxy headers", async () => {
      let ip: string | undefined;
      handler = (_, ctx) => { ip = ctx.ip; };

      await connect("/");

      assert.ok(ip, "expected a peer address");
    });

    it("should hand onAuth() a working Headers instance and address", async () => {
      let seen: AuthContext | undefined;

      matchMaker.defineRoomType("authctx", class _ extends Room {
        onAuth(_client: any, _options: any, context: AuthContext) {
          seen = context;
          return true;
        }
      });

      const reservation = await matchMaker.joinOrCreate("authctx", {});
      await connect(`/${reservation.processId}/${reservation.roomId}?sessionId=${reservation.sessionId}`, {
        "x-forwarded-for": "203.0.113.7, 10.0.0.1",
      });

      assert.ok(seen, "expected onAuth to run");
      assert.ok(seen.headers instanceof Headers, "context.headers must be a Headers instance");
      assert.strictEqual(`localhost:${TEST_PORT}`, seen.headers.get("host"));
      assert.strictEqual("203.0.113.7", seen.ip);
    });

    it("should answer with the returned Response instead of upgrading", async () => {
      handler = async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return new Response(null, { status: 200, headers: { "fly-replay": "instance=abc123" } });
      };

      const response = await connectRefused("/other-process/room-id?sessionId=abc");

      assert.strictEqual(200, response.statusCode);
      assert.strictEqual("instance=abc123", response.headers["fly-replay"]);
    });

    it("should send the Response body and status text", async () => {
      handler = () => new Response("nope", { status: 503 });

      const response = await connectRefused("/");

      assert.strictEqual(503, response.statusCode);
      assert.strictEqual("4", response.headers["content-length"]);
    });

    it("should answer 500 and keep serving when the handler throws", async () => {
      handler = async () => { throw new Error("boom"); };
      assert.strictEqual(500, (await connectRefused("/")).statusCode);

      // the process must still be alive and upgrading
      handler = () => {};
      assert.strictEqual(undefined, await connect("/"));
    });
  });
}

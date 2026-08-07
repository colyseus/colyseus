/**
 * A non-JSON body on `POST /matchmake/*` used to throw a SyntaxError from
 * inside the request stream's "end" listener in the raw Node adapter. Nothing
 * could catch it there, so it became an uncaughtException and took the whole
 * process down:
 *
 *   SyntaxError: Unexpected token 'P', "PR" is not valid JSON
 *     at IncomingMessage.<anonymous> (.../@colyseus/core/build/router/node.mjs)
 */
import assert from "assert";
import http from "http";
import net from "net";
import { LocalPresence, LocalDriver, matchMaker, defineServer, defineRoom, Room, createNodeMatchmakingMiddleware } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";

class DummyRoom extends Room {
  onCreate() {}
  onJoin() {}
  onLeave() {}
  onDispose() {}
}

const TEST_PORT = 8577;

const MALFORMED = {
  "HTTP/2 connection preface": "PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n",
  "short garbage": "PR",
  "bare word": "hello",
  "truncated object": '{"a":',
  "trailing garbage": "{}{}{}",
  "NUL bytes": "\0\0\0\0",
};

/** Raw socket: an HTTP client would refuse to send some of these bodies. */
function rawPost(body: string, contentType = "application/json") {
  return new Promise<{ status: number, payload: string }>((resolve, reject) => {
    const sock = net.connect(TEST_PORT, "127.0.0.1", () => sock.write(
      `POST /matchmake/joinOrCreate/dummy HTTP/1.1\r\nHost: localhost\r\n` +
      `Content-Type: ${contentType}\r\nContent-Length: ${Buffer.byteLength(body)}\r\n` +
      `Connection: close\r\n\r\n${body}`
    ));

    let out = "";
    sock.on("data", (d) => out += d.toString());
    sock.on("error", reject);
    sock.on("close", () => resolve({
      status: Number((out.split("\r\n")[0] || "").split(" ")[1]),
      payload: out.split("\r\n\r\n")[1] || "",
    }));
  });
}

async function assertAllRejected() {
  for (const [name, body] of Object.entries(MALFORMED)) {
    const { status } = await rawPost(body);
    assert.strictEqual(status, 400, `${name}: expected 400, got ${status}`);
  }
}

describe("Malformed matchmaking requests", () => {

  describe("raw Node adapter (used by colyseus/vite)", () => {
    let server: http.Server;

    before(async () => {
      const middleware = createNodeMatchmakingMiddleware();
      server = http.createServer((req, res) =>
        middleware(req, res, () => { res.writeHead(404); res.end(); }));
      await new Promise<void>((resolve) => server.listen(TEST_PORT, resolve));
    });

    after(async () => { await new Promise((resolve) => server.close(resolve)); });

    it("should reply 400 instead of crashing the process", assertAllRejected);

    it("should reply 400 regardless of content-type", async () => {
      assert.strictEqual((await rawPost("PR", "text/plain")).status, 400);
    });

    it("should reject a body over the size cap", async () => {
      const status = await new Promise<number>((resolve) => {
        const sock = net.connect(TEST_PORT, "127.0.0.1", () => {
          sock.write(
            `POST /matchmake/joinOrCreate/dummy HTTP/1.1\r\nHost: localhost\r\n` +
            `Content-Type: application/json\r\nContent-Length: ${64 * 1024 * 1024}\r\n\r\n`
          );
          // stop as soon as the server gives up on us
          const pump = () => { if (sock.writable) { sock.write(Buffer.alloc(256 * 1024, 0x41), pump); } };
          pump();
        });
        let out = "";
        sock.on("data", (d) => out += d.toString());
        sock.on("error", () => resolve(413)); // socket destroyed past the cap
        sock.on("close", () => resolve(Number((out.split("\r\n")[0] || "").split(" ")[1]) || 413));
      });
      assert.strictEqual(status, 413);
    });
  });

  describe("default router (production path)", () => {
    let server: ReturnType<typeof defineServer>;

    before(async () => {
      server = defineServer({
        greet: false,
        gracefullyShutdown: false,
        presence: new LocalPresence(),
        driver: new LocalDriver(),
        transport: new WebSocketTransport(),
        rooms: { dummy: defineRoom(DummyRoom) },
      });
      await matchMaker.setup(new LocalPresence(), new LocalDriver());
      await server.listen(TEST_PORT);
    });

    after(async () => { await server.gracefullyShutdown(false); });

    it("should reply 400 instead of 500", assertAllRejected);

    it("should still accept a well-formed body", async () => {
      const res = await rawPost(JSON.stringify({ hello: "world" }));
      assert.strictEqual(res.status, 200);
      assert.ok(JSON.parse(res.payload).sessionId);
    });
  });

});

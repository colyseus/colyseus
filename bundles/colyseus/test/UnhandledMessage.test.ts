import assert from "assert";

import * as Colyseus from "@colyseus/sdk";
import { CloseCode, ErrorCode, OnMessageException, Room, Server, matchMaker, setDevMode } from "@colyseus/core";
import { waitUntil } from "./utils/index.ts";

const TEST_PORT = 8583;
const TEST_ENDPOINT = `ws://localhost:${TEST_PORT}`;

function captureConsole(method: "warn" | "error") {
  const original = console[method];
  const calls: string[] = [];
  console[method] = (...args: any[]) => { calls.push(args.join(" ")); };
  return { calls, restore: () => { console[method] = original; } };
}

describe("Unhandled messages", () => {
  let server: Server;
  const client = new Colyseus.Client(TEST_ENDPOINT);

  beforeEach(async () => {
    server = new Server({ greet: false, gracefullyShutdown: false });
    matchMaker.setup(undefined, undefined);
    await server.listen(TEST_PORT);
  });

  afterEach(async () => {
    setDevMode(false);
    await Promise.all(matchMaker.disconnectAll());
    await server.gracefullyShutdown(false);
  });

  it("calls onUnhandledMessage before disconnecting the client", async () => {
    let received: any = undefined;

    matchMaker.defineRoomType("my_room", class extends Room {
      onUnhandledMessage(client, type, message) {
        received = { sessionId: client.sessionId, type, message, connected: this.clients.includes(client) };
      }
    });

    const conn = await client.joinOrCreate("my_room");
    const left = new Promise<[number, string]>((resolve) => conn.onLeave((code, reason) => resolve([code, reason])));

    conn.send("unknown", { x: 1 });

    const [code, reason] = await left;
    assert.deepStrictEqual(received, { sessionId: conn.sessionId, type: "unknown", message: { x: 1 }, connected: true });
    assert.strictEqual(code, CloseCode.WITH_ERROR);
    assert.match(reason, /"unknown" not registered/);
  });

  it("logs a warning without onUnhandledMessage", async () => {
    matchMaker.defineRoomType("my_room", class extends Room {});

    const warn = captureConsole("warn");
    try {
      const conn = await client.joinOrCreate("my_room");
      const left = new Promise<number>((resolve) => conn.onLeave((code) => resolve(code)));

      conn.send("unknown");

      assert.strictEqual(await left, CloseCode.WITH_ERROR);
      const logged = warn.calls.filter((line) => line.includes(`'${conn.sessionId}' sent "unknown"`));
      assert.strictEqual(logged.length, 1);
      assert.match(logged[0], /Disconnecting the client/);
    } finally {
      warn.restore();
    }
  });

  it("devMode: replies with an error and keeps the client connected", async () => {
    setDevMode(true);

    let receivedType: any = undefined;
    matchMaker.defineRoomType("my_room", class extends Room {
      messages = { ping: (client) => client.send("pong") };
      onUnhandledMessage(_client, type) { receivedType = type; }
    });

    const conn = await client.joinOrCreate("my_room");
    const error = new Promise<number>((resolve) => conn.onError((code) => resolve(code)));
    const pong = new Promise((resolve) => conn.onMessage("pong", resolve));

    conn.send("unknown");
    assert.strictEqual(await error, ErrorCode.INVALID_PAYLOAD);
    assert.strictEqual(receivedType, "unknown");

    conn.send("ping");
    await pong;
    await conn.leave();
  });

  it("devMode: the warning says what happens outside devMode", async () => {
    setDevMode(true);
    matchMaker.defineRoomType("my_room", class extends Room {});

    const warn = captureConsole("warn");
    try {
      const conn = await client.joinOrCreate("my_room");
      const error = new Promise((resolve) => conn.onError(resolve));
      conn.send("unknown");
      await error;

      const logged = warn.calls.filter((line) => line.includes(`sent "unknown"`));
      assert.strictEqual(logged.length, 1);
      assert.match(logged[0], /outside devMode, the client is disconnected/);
      await conn.leave();
    } finally {
      warn.restore();
    }
  });

  it("isn't called for messages the '*' fallback handles", async () => {
    let called = false;

    matchMaker.defineRoomType("my_room", class extends Room {
      messages = { "*": (client, type) => client.send("echo", type) };
      onUnhandledMessage() { called = true; }
    });

    const conn = await client.joinOrCreate("my_room");
    const echo = new Promise((resolve) => conn.onMessage("echo", resolve));

    conn.send("unknown");
    assert.strictEqual(await echo, "unknown");
    assert.strictEqual(called, false);
    await conn.leave();
  });

  it("sendBytes(): receives the sent type and a Buffer", async () => {
    let received: any = undefined;

    matchMaker.defineRoomType("my_room", class extends Room {
      onUnhandledMessage(_client, type, message) { received = { type, message }; }
    });

    const conn = await client.joinOrCreate("my_room");
    const left = new Promise((resolve) => conn.onLeave(resolve));

    conn.sendBytes("raw", new Uint8Array([1, 2, 3]));
    await left;

    assert.strictEqual(received.type, "raw");
    assert.ok(Buffer.isBuffer(received.message));
    assert.deepStrictEqual([...received.message], [1, 2, 3]);
  });

  it("request(): is called, and the request still rejects with no_handler", async () => {
    let received: any = undefined;

    matchMaker.defineRoomType("my_room", class extends Room {
      onUnhandledMessage(_client, type, message) { received = { type, message }; }
    });

    const conn = await client.joinOrCreate("my_room");

    await assert.rejects(conn.request("unknown", { n: 1 }), /no onMessage\("unknown"\) handler/);
    assert.deepStrictEqual(received, { type: "unknown", message: { n: 1 } });
    assert.ok(conn.connection.isOpen, "a request without a handler doesn't disconnect");
    await conn.leave();
  });

  it("an error it throws goes to onUncaughtException, and the client is still disconnected", async () => {
    let caught: any = undefined;

    matchMaker.defineRoomType("my_room", class extends Room {
      onUnhandledMessage() { throw new Error("reporting failed"); }
      onUncaughtException(error, methodName) { caught = { error, methodName }; }
    });

    const conn = await client.joinOrCreate("my_room");
    const left = new Promise<number>((resolve) => conn.onLeave((code) => resolve(code)));

    conn.send("unknown", "payload");

    assert.strictEqual(await left, CloseCode.WITH_ERROR);
    assert.ok(caught.error instanceof OnMessageException);
    assert.strictEqual(caught.error.message, "reporting failed");
    assert.strictEqual(caught.error.type, "unknown");
    assert.strictEqual(caught.error.payload, "payload");
    assert.strictEqual(caught.methodName, "onMessage");
  });

  it("an async rejection without onUncaughtException is logged", async () => {
    matchMaker.defineRoomType("my_room", class extends Room {
      async onUnhandledMessage() { throw new Error("async reporting failed"); }
    });

    const error = captureConsole("error");
    try {
      const conn = await client.joinOrCreate("my_room");
      const left = new Promise((resolve) => conn.onLeave(resolve));
      conn.send("unknown");
      await left;
      await waitUntil(() => error.calls.some((line) => line.includes("async reporting failed")));
    } finally {
      error.restore();
    }
  });

  it("a burst of unhandled messages is reported once, and the room still sees the client leave", async () => {
    const received: any[] = [];
    let serverLeaveCode: number | undefined = undefined;

    matchMaker.defineRoomType("my_room", class extends Room {
      onUnhandledMessage(_client, type) { received.push(type); }
      onLeave(_client, code) { serverLeaveCode = code; }
    });

    const conn = await client.joinOrCreate("my_room");
    const left = new Promise((resolve) => conn.onLeave(resolve));

    conn.send("a");
    conn.send("b");
    conn.send("c");
    await left;

    assert.deepStrictEqual(received, ["a"]);
    await waitUntil(() => serverLeaveCode !== undefined);
    assert.strictEqual(serverLeaveCode, CloseCode.WITH_ERROR);
  });
});

import assert from "assert";
import { encode } from "@colyseus/schema";
import { CloseCode, logger } from "@colyseus/core";
import { H3Client } from "@colyseus/h3-transport/H3Client";

/**
 * A read loop that dies on a rejected `read()` leaves the client reporting
 * itself OPEN: the room never hears `onLeave` and keeps encoding patches for a
 * session it can no longer hear. https://github.com/colyseus/colyseus/issues/975
 */

function frame(payload: Uint8Array): Uint8Array {
  const prefix = new Uint8Array(9);
  const prefixLength = encode.number(prefix as any, payload.length, { offset: 0 });
  const out = new Uint8Array(prefixLength + payload.length);
  out.set(prefix.subarray(0, prefixLength), 0);
  out.set(payload, prefixLength);
  return out;
}

/** A real `ReadableStream` — an errored one stays errored, as the transport sees it. */
function controllableStream() {
  let controller: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({ start: (c) => { controller = c; } });
  return {
    stream,
    push: (payload: Uint8Array) => controller.enqueue(frame(payload)),
    fail: (reason: any) => controller.error(reason),
    end: () => controller.close(),
  };
}

/** Lets every pending read/close turn settle, for asserting that nothing happened. */
async function settle() {
  for (let i = 0; i < 4; i++) { await new Promise((resolve) => setImmediate(resolve)); }
}

async function connected() {
  const bidi = controllableStream();
  const datagrams = controllableStream();

  let resolveClosed: (info: any) => void;
  const closeCalls: any[] = [];

  const session: any = {
    // the real session marks itself before erroring its streams — the signal
    // `_onChannelFailure` reads to tell a teardown from a mid-session failure
    state: "connected",
    ready: Promise.resolve(),
    closed: new Promise<any>((resolve) => { resolveClosed = resolve; }),
    datagrams: { readable: datagrams.stream },
    createBidirectionalStream: async () => ({
      readable: bidi.stream,
      writable: new WritableStream<Uint8Array>({ write() { /* discard */ } }),
    }),
    close(info: any) {
      closeCalls.push(info);
      session.state = "closed";
      resolveClosed({ closeCode: info?.closeCode, reason: info?.reason || "" });
    },
  };

  const messages: Uint8Array[] = [];
  let resolveOpen: () => void;
  let resolveClose: () => void;
  const handshaken = new Promise<void>((resolve) => { resolveOpen = resolve; });
  const dropped = new Promise<void>((resolve) => { resolveClose = resolve; });
  let closes = 0;

  const client = new H3Client(session, () => resolveOpen());
  client.sessionId = "s1";
  client.ref.on("message", (m: Uint8Array) => messages.push(m));
  client.ref.on("close", () => { closes++; resolveClose(); });

  // the constructor spends the first bidi read on `onInitialMessage`
  bidi.push(new Uint8Array([0]));
  await handshaken;
  assert.strictEqual(client.readyState, 1, "client should be OPEN");

  return {
    client, bidi, datagrams, messages, dropped,
    closes: () => closes,
    /** session teardowns the client itself asked for */
    errorCloses: () => closeCalls.filter((c) => c?.closeCode === CloseCode.WITH_ERROR),
    endSession: (reason = "bye") => session.close({ closeCode: CloseCode.NORMAL_CLOSURE, reason }),
  };
}

describe("Transport: H3 read loops", () => {

  // `logger` IS `console`, so restore per test or the patch leaks into the suite
  const originalWarn = logger.warn;
  let warnings: string[];

  beforeEach(() => {
    warnings = [];
    logger.warn = (...args: any[]) => { warnings.push(args.join(" ")); };
  });

  afterEach(() => { logger.warn = originalWarn; });

  it("delivers frames on both channels while open", async () => {
    const { bidi, datagrams, messages } = await connected();

    bidi.push(new Uint8Array([1, 1]));
    datagrams.push(new Uint8Array([2, 2]));
    await settle();

    assert.strictEqual(messages.length, 2);
  });

  it("drops the client when the reliable channel fails mid-session", async () => {
    const { client, bidi, dropped, closes, errorCloses } = await connected();

    bidi.fail(new Error("Resetstream with code:1"));
    await dropped;

    assert.strictEqual(client.readyState, 3, "client should be CLOSED, not left reporting OPEN");
    assert.strictEqual(closes(), 1, "room must hear 'close' so onLeave runs");
    assert.strictEqual(errorCloses().length, 1, "the WebTransport session should be torn down");
    assert.strictEqual(warnings.length, 1, "the failure must not be swallowed");
    assert.match(warnings[0], /its reliable channel/);
  });

  it("drops the client when the unreliable channel fails mid-session", async () => {
    const { client, datagrams, dropped, closes, errorCloses } = await connected();

    datagrams.fail(new Error("transient datagram hiccup"));
    await dropped;

    assert.strictEqual(client.readyState, 3);
    assert.strictEqual(closes(), 1);
    assert.strictEqual(errorCloses().length, 1);
    assert.strictEqual(warnings.length, 1);
    assert.match(warnings[0], /its unreliable channel/);
  });

  it("reports a rejection that carries no message", async () => {
    const { bidi, dropped, errorCloses } = await connected();

    // some impls reject with a plain close-info object, not an Error
    bidi.fail({ closeCode: 1, reason: "reset" });
    await dropped;

    assert.strictEqual(errorCloses().length, 1);
    assert.strictEqual(warnings.length, 1, "an unshaped rejection must still be reported");
  });

  it("does not retry a rejected read (an errored stream stays errored)", async () => {
    const { client, bidi, dropped } = await connected();

    const reader = (client as any)._bidiReader;
    const read = reader.read.bind(reader);
    let retries = 0;
    reader.read = () => { retries++; return read(); };

    bidi.fail(new Error("gone"));
    await dropped;
    await settle();

    assert.strictEqual(retries, 0, "retrying an errored stream would spin on the same rejection");
  });

  it("stays quiet when the streams error because the session is closing", async () => {
    const { client, bidi, datagrams, endSession, dropped, closes, errorCloses } = await connected();

    // how a teardown actually lands: the session marks itself, then the streams
    // error, then `closed` settles
    endSession();
    bidi.fail(new Error("Session closed with code 1000"));
    datagrams.fail(new Error("Session closed with code 1000"));
    await dropped;
    await settle();

    assert.deepStrictEqual(warnings, [], "an ordinary disconnect must not warn");
    assert.strictEqual(errorCloses().length, 0, "no failure teardown on a normal close");
    assert.strictEqual(client.readyState, 3);
    assert.strictEqual(closes(), 1, "'close' should fire exactly once");
  });

  it("ends both loops on a clean stream end without closing twice", async () => {
    const { client, bidi, datagrams, endSession, dropped, closes } = await connected();

    // @fails-components closes (not errors) the datagram stream on teardown
    datagrams.end();
    bidi.end();
    endSession();
    await dropped;
    await settle();

    assert.deepStrictEqual(warnings, []);
    assert.strictEqual(client.readyState, 3);
    assert.strictEqual(closes(), 1);
  });

});

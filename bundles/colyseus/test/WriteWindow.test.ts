import assert from "assert";
import { EventEmitter } from "events";

import { schema, t, type SchemaType } from "@colyseus/schema";
import { Client as SDKClient } from "@colyseus/sdk";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { uWebSocketClient, uWebSocketsTransport } from "@colyseus/uwebsockets-transport";
import { FrameReassembler, H3Client } from "@colyseus/h3-transport/H3Client";
import { ClientState, CloseCode, LocalDriver, LocalPresence, matchMaker, Room, Server } from "@colyseus/core";
import { waitUntil } from "./utils/index.ts";

//
// The write window: what a room sends during one tick of its loop (and with its
// patch) reaches each client's socket as one write, the same frames in the same
// order, instead of one write per frame.
//

const State = schema({ n: t.uint16().default(0) });
type State = SchemaType<typeof State>;

/**
 * On the step after `burst` is set: `burst` broadcasts and as many sends to each client (in a `batch()` of their own
 * with `nestBatch`), then a patch between two more; with `throwAfterBurst`, the step throws right after the burst
 * instead (once). On the step after `toOne` is set: that many sends to the first client alone, which then leaves
 * with `kickAfter`.
 */
class BurstRoom extends Room {
  state = new State();
  burst = 0;
  toOne = 0;
  kickAfter = false;
  leaveFirst = false;
  throwAfterBurst = false;
  nestBatch = false;
  /** What the last `batched` handler's `this.batch()` returned, and what `batched-throw`'s threw. */
  batchReturned: unknown = undefined;
  rethrown: Error | undefined = undefined;
  onCreate() {
    this.patchRate = 0; // patches only where the step asks: every write counted is the burst's
    this.autoBatch = true;
    this.setFixedTimestep(() => {
      if (this.toOne > 0) {
        const n = this.toOne;
        this.toOne = 0;
        for (let i = 0; i < n; i++) { this.clients[0].send("c", i); }
        if (this.kickAfter) { this.clients[0].leave(CloseCode.CONSENTED); }
        return;
      }
      const n = this.burst;
      if (n === 0) { return; }
      this.burst = 0;
      for (let i = 0; i < n; i++) {
        this.broadcast("b", i);
        const sendC = () => { for (const client of this.clients) { client.send("c", i); } };
        if (this.nestBatch) { this.batch(sendC); } else { sendC(); }
      }
      if (this.throwAfterBurst) { this.throwAfterBurst = false; throw new Error("the step failed"); }
      this.broadcast("order", "before patch");
      this.state.n = n;
      this.broadcastPatch(); // a window inside the window
      this.broadcast("order", "after patch");
      if (this.leaveFirst) { this.clients[0].leave(); }
    }, 30);
    // the same burst from a message handler: outside any tick, so outside the window
    this.onMessage("burst", (client, n: number) => { for (let i = 0; i < n; i++) { this.broadcast("b", i); } });
    // …and from one that batches it
    this.onMessage("batched", (client, n: number) => {
      this.batchReturned = this.batch(() => { for (let i = 0; i < n; i++) { this.broadcast("b", i); } return n; });
    });
    this.onMessage("batched-throw", (client, n: number) => {
      try {
        this.batch(() => { for (let i = 0; i < n; i++) { this.broadcast("b", i); } throw new Error("the batch failed"); });
      } catch (e: any) {
        this.rethrown = e;
      }
    });
  }
}

/** The same room as a room is by default: `autoBatch` off. */
class UnbatchedBurstRoom extends BurstRoom {
  onCreate() { super.onCreate(); this.autoBatch = false; }
}

/** The same room, catching its own exceptions (the loop's step is then wrapped: the throw never leaves the timer). */
class CatchingBurstRoom extends BurstRoom {
  caught: Error[] = [];
  onUncaughtException(error: Error) { this.caught.push(error); }
}

/**
 * Run `fn` with the process's own `uncaughtException` listeners (mocha's) set aside, collecting what escapes into
 * `escaped`: a step that throws in a room without `onUncaughtException` throws out of its timer.
 */
async function withEscapes(fn: (escaped: Error[]) => Promise<void>) {
  const listeners = process.listeners("uncaughtException");
  process.removeAllListeners("uncaughtException");
  const escaped: Error[] = [];
  const collect = (e: Error) => { escaped.push(e); };
  process.on("uncaughtException", collect);
  try {
    await fn(escaped);
  } finally {
    process.removeListener("uncaughtException", collect);
    for (const l of listeners) { process.on("uncaughtException", l as any); }
  }
}

/** Each frame and each state change, in the order the SDK dispatched them. */
function record(conn: any) {
  const seen: string[] = [];
  conn.onMessage("b", (i: number) => seen.push(`b${i}`));
  conn.onMessage("c", (i: number) => seen.push(`c${i}`));
  conn.onMessage("order", (what: string) => seen.push(what));
  conn.onStateChange((s: State) => { if (s.n) { seen.push(`state ${s.n}`); } });
  return seen;
}

/** One SDK client in a fresh room, joined. */
async function oneClient(endpoint: string, roomName = "burst") {
  const a = await new SDKClient(endpoint).create<State>(roomName);
  const room = matchMaker.getLocalRoomById(a.roomId) as BurstRoom;
  await waitUntil(() => room.clients[0]?.state === ClientState.JOINED);
  return { a, room };
}

/** Two SDK clients in a fresh room, both joined. */
async function twoClients(endpoint: string, roomName = "burst") {
  const { a, room } = await oneClient(endpoint, roomName);
  const b = await new SDKClient(endpoint).joinById<State>(a.roomId);
  await waitUntil(() => room.clients.length === 2 && room.clients.every((c) => c.state === ClientState.JOINED));
  return { a, b, room };
}

/** A client made to leave mid-tick still gets, before its close, what the tick sent it. */
async function kickedMidTick(endpoint: string) {
  const { a, room } = await oneClient(endpoint);
  const seen = record(a);
  let seenAtClose: string[] | undefined;
  a.onLeave(() => { seenAtClose = seen.slice(); });

  room.kickAfter = true;
  room.toOne = 5;
  await waitUntil(() => seenAtClose !== undefined);
  assert.deepStrictEqual(seenAtClose, ["c0", "c1", "c2", "c3", "c4"]);
}

/** What two clients each see from a burst of `n`. */
const burstOf = (n: number) => [
  ...Array.from({ length: n }, (_, i) => [`b${i}`, `c${i}`]).flat(),
  "before patch", `state ${n}`, "after patch",
];

describe("Write window", () => {

  describe("ws-transport", () => {
    const TEST_PORT = 8583;
    const endpoint = `ws://localhost:${TEST_PORT}`;

    let server: Server;
    let presence: LocalPresence;
    let driver: LocalDriver;

    before(async () => {
      presence = new LocalPresence();
      driver = new LocalDriver();
      // no pings: a ping is a write of its own, and every write here is counted
      server = new Server({ greet: false, gracefullyShutdown: false, presence, driver, transport: new WebSocketTransport({ pingInterval: 0 }) });
      await matchMaker.setup(presence, driver);
      server.define("burst", BurstRoom);
      server.define("burst-caught", CatchingBurstRoom);
      server.define("burst-unbatched", UnbatchedBurstRoom);
      await server.listen(TEST_PORT);
    });

    after(async () => {
      await server.gracefullyShutdown(false);
      await driver.shutdown();
    });

    /** Count the server socket's writes to the OS (net.Socket's `_write` / `_writev`). */
    function countWrites(room: Room, k: number) {
      const socket = (room.clients[k] as any).ref._socket;
      const counted = { writes: 0, chunks: 0 };
      const write = socket._write.bind(socket), writev = socket._writev.bind(socket);
      socket._write = (chunk: any, enc: any, cb: any) => { counted.writes++; counted.chunks++; return write(chunk, enc, cb); };
      socket._writev = (chunks: any[], cb: any) => { counted.writes++; counted.chunks += chunks.length; return writev(chunks, cb); };
      return counted;
    }

    /** Count how often the room corks client `k`. */
    function countCorks(room: Room, k: number) {
      const client = room.clients[k] as any;
      const counted = { corks: 0 };
      const cork = client.cork.bind(client);
      client.cork = () => { counted.corks++; cork(); };
      return counted;
    }

    const ticks = (n: number) => new Promise((r) => setTimeout(r, Math.ceil(n * 1000 / 30)));

    it("by default (no autoBatch) a tick writes each frame as it comes, as before, and corks no client", async () => {
      const { a, b, room } = await twoClients(endpoint, "burst-unbatched");
      assert.strictEqual(room.autoBatch, false);
      const seenA = record(a);
      const corksA = countCorks(room, 0), corksB = countCorks(room, 1);
      const writesA = countWrites(room, 0);

      room.burst = 5;
      await waitUntil(() => seenA.length === burstOf(5).length);
      assert.deepStrictEqual(seenA, burstOf(5));
      assert.strictEqual(writesA.writes, burstOf(5).length, "one write a frame: 13");
      assert.deepStrictEqual([corksA.corks, corksB.corks], [0, 0]);

      // …and a patch with a frame after it: two writes, as before
      room.state.n = 7;
      room.clients[0].send("c", 1, { afterNextPatch: true });
      room.broadcastPatch();
      await waitUntil(() => seenA.length === burstOf(5).length + 2);
      assert.strictEqual(writesA.writes, burstOf(5).length + 2);
      assert.deepStrictEqual([corksA.corks, corksB.corks], [0, 0]);

      await a.leave();
      await b.leave();
    });

    it("by default (no autoBatch) batch() still writes its burst as one write", async () => {
      const { a, b, room } = await twoClients(endpoint, "burst-unbatched");
      const seenA = record(a);
      const writesA = countWrites(room, 0);

      a.send("batched", 10);
      await waitUntil(() => seenA.length === 10);
      assert.deepStrictEqual(seenA, Array.from({ length: 10 }, (_, i) => `b${i}`));
      assert.strictEqual(writesA.writes, 1);

      await a.leave();
      await b.leave();
    });

    it("a tick that sends nothing corks no client, nor does a patch with nothing after it", async () => {
      const { a, b, room } = await twoClients(endpoint);
      const corksA = countCorks(room, 0), corksB = countCorks(room, 1);
      const writesA = countWrites(room, 0);

      await ticks(10);
      assert.deepStrictEqual([corksA.corks, corksB.corks], [0, 0]);
      assert.strictEqual(writesA.writes, 0);

      // a patch alone is one frame a client: written as it always was
      room.state.n = 99;
      room.broadcastPatch();
      await waitUntil(() => a.state.n === 99 && b.state.n === 99);
      assert.deepStrictEqual([corksA.corks, corksB.corks], [0, 0]);
      assert.strictEqual(writesA.writes, 1);

      await a.leave();
      await b.leave();
    });

    it("a tick that sends to one client corks that one alone", async () => {
      const { a, b, room } = await twoClients(endpoint);
      const seenA = record(a), seenB = record(b);
      const corksA = countCorks(room, 0), corksB = countCorks(room, 1);
      const writesA = countWrites(room, 0), writesB = countWrites(room, 1);

      room.toOne = 5;
      await waitUntil(() => seenA.length === 5);
      await ticks(3);
      assert.deepStrictEqual(seenA, ["c0", "c1", "c2", "c3", "c4"]);
      assert.deepStrictEqual(seenB, []);
      assert.deepStrictEqual([corksA.corks, corksB.corks], [1, 0]);
      assert.deepStrictEqual([writesA.writes, writesB.writes], [1, 0]);

      await a.leave();
      await b.leave();
    });

    it("a patch with frames after it goes out with them as one write", async () => {
      const { a, b, room } = await twoClients(endpoint);
      const seenA = record(a);
      const writesA = countWrites(room, 0);

      room.state.n = 7;
      room.clients[0].send("c", 1, { afterNextPatch: true });
      room.broadcastPatch();
      await waitUntil(() => seenA.length === 2);
      assert.deepStrictEqual(seenA, ["state 7", "c1"]);
      assert.strictEqual(writesA.writes, 1);

      await a.leave();
      await b.leave();
    });

    it("batch() inside a tick adds no window of its own", async () => {
      const { a, b, room } = await twoClients(endpoint);
      const seenA = record(a);
      const corksA = countCorks(room, 0);
      const writesA = countWrites(room, 0);

      room.nestBatch = true;
      room.burst = 10;
      await waitUntil(() => seenA.length === burstOf(10).length);
      assert.deepStrictEqual(seenA, burstOf(10));
      assert.strictEqual(corksA.corks, 1);
      assert.strictEqual(writesA.writes, 1);

      await a.leave();
      await b.leave();
    });

    it("a batch that throws is rethrown, what it sent is written, and the next batch writes on its own", async () => {
      const { a, b, room } = await twoClients(endpoint);
      const seenA = record(a);
      const writesA = countWrites(room, 0);

      a.send("batched-throw", 5);
      await waitUntil(() => seenA.length === 5);
      assert.match(room.rethrown!.message, /the batch failed/);
      assert.strictEqual(writesA.writes, 1);

      a.send("batched", 3);
      await waitUntil(() => seenA.length === 8);
      assert.deepStrictEqual(seenA, ["b0", "b1", "b2", "b3", "b4", "b0", "b1", "b2"]);
      assert.strictEqual(writesA.writes, 2);

      await a.leave();
      await b.leave();
    });

    it("a tick's frames reach each socket as one write, in order", async () => {
      const { a, b, room } = await twoClients(endpoint);
      const seenA = record(a), seenB = record(b);
      const writesA = countWrites(room, 0), writesB = countWrites(room, 1);

      room.burst = 40;
      const expected = burstOf(40);
      await waitUntil(() => seenA.length >= expected.length && seenB.length >= expected.length);

      assert.deepStrictEqual(seenA, expected);
      assert.deepStrictEqual(seenB, expected);
      // 83 frames each (two chunks a frame: ws's header and its payload), one write
      assert.strictEqual(writesA.writes, 1, `client A: ${writesA.writes} writes for ${writesA.chunks} chunks`);
      assert.strictEqual(writesB.writes, 1, `client B: ${writesB.writes} writes for ${writesB.chunks} chunks`);
      assert.ok(writesA.chunks >= 83);

      await a.leave();
      await b.leave();
    });

    it("outside a tick (a message handler) each frame is its own write, as before", async () => {
      const { a, room } = await oneClient(endpoint);
      const seen = record(a);
      const writes = countWrites(room, 0);

      a.send("burst", 10);
      await waitUntil(() => seen.length === 10);
      assert.strictEqual(writes.writes, 10);

      await a.leave();
    });

    it("this.batch() writes a handler's burst as one write, and returns what its function returns", async () => {
      const { a, room } = await oneClient(endpoint);
      const seen = record(a);
      const writes = countWrites(room, 0);

      a.send("batched", 10);
      await waitUntil(() => seen.length === 10);
      assert.deepStrictEqual(seen, Array.from({ length: 10 }, (_, i) => `b${i}`));
      assert.strictEqual(writes.writes, 1);
      assert.strictEqual(room.batchReturned, 10);

      await a.leave();
    });

    // A step that throws must close the tick's window: Node keeps firing the interval after a throw, and a window
    // left open would hold every client's writes from then on (the room goes silent).
    for (const [name, roomName] of [["without onUncaughtException (the throw leaves the timer)", "burst"], ["with onUncaughtException", "burst-caught"]] as const) {
      it(`a step that throws, ${name}: what it sent is written, and the next ticks are too`, async () => {
        await withEscapes(async (escaped) => {
          const { a, room } = await oneClient(endpoint, roomName);
          const seen = record(a);
          const writes = countWrites(room, 0);

          room.throwAfterBurst = true;
          room.burst = 5;
          await waitUntil(() => seen.length === 10);
          assert.deepStrictEqual(seen, Array.from({ length: 5 }, (_, i) => [`b${i}`, `c${i}`]).flat());
          assert.strictEqual(writes.writes, 1, "the burst before the throw, in one write");

          // where the error went
          const caught = roomName === "burst-caught" ? (room as CatchingBurstRoom).caught : escaped;
          assert.strictEqual(caught.length, 1);
          assert.match(caught[0].message, /the step failed/);
          if (roomName === "burst") { assert.strictEqual(escaped.length, 1); } else { assert.strictEqual(escaped.length, 0); }

          // …and the window isn't stuck: the next tick's burst arrives whole, in one write of its own
          seen.length = 0;
          room.burst = 3;
          await waitUntil(() => seen.length === burstOf(3).length);
          assert.deepStrictEqual(seen, burstOf(3));
          assert.strictEqual(writes.writes, 2);

          await a.leave();
        });
      });
    }

    it("a client leaving mid-tick doesn't hold the others' frames", async () => {
      const { a, b, room } = await twoClients(endpoint);
      record(a);
      const seenB = record(b);

      room.leaveFirst = true;
      room.burst = 5;
      await waitUntil(() => seenB.includes("after patch"));
      assert.strictEqual(seenB.length, 5 * 2 + 3);

      // …and the next tick writes as it should
      room.leaveFirst = false;
      room.burst = 2;
      await waitUntil(() => seenB.filter((s) => s === "after patch").length === 2);

      await b.leave();
    });

    it("a client made to leave mid-tick gets what the tick sent it first", () => kickedMidTick(endpoint));
  });

  describe("uwebsockets-transport, a real socket", () => {
    const TEST_PORT = 8584;
    const endpoint = `ws://localhost:${TEST_PORT}`;
    let server: Server;
    let presence: LocalPresence;
    let driver: LocalDriver;

    before(async () => {
      presence = new LocalPresence();
      driver = new LocalDriver();
      server = new Server({ greet: false, gracefullyShutdown: false, presence, driver, transport: new uWebSocketsTransport({ sendPingsAutomatically: false }) });
      await matchMaker.setup(presence, driver);
      server.define("burst", BurstRoom);
      await server.listen(TEST_PORT);
    });

    after(async () => {
      server.transport.shutdown();
      await driver.shutdown();
    });

    it("a tick's frames arrive whole and in order", async () => {
      const { a, b, room } = await twoClients(endpoint);
      const seenA = record(a), seenB = record(b);

      room.burst = 40;
      await waitUntil(() => seenA.length >= 83 && seenB.length >= 83);
      assert.deepStrictEqual(seenA, burstOf(40));
      assert.deepStrictEqual(seenB, burstOf(40));

      await a.leave();
      await b.leave();
    });

    it("a client made to leave mid-tick gets what the tick sent it first", () => kickedMidTick(endpoint));
  });

  describe("uwebsockets-transport", () => {
    /** A uWS socket that records what it was sent, and whether inside a cork. */
    function fakeUWS() {
      const sent: Array<{ bytes: number[]; corked: boolean }> = [];
      let corked = false, corks = 0;
      const ws = {
        send(data: Uint8Array) { sent.push({ bytes: Array.from(data), corked }); return 1; },
        cork(cb: () => void) { corks++; corked = true; try { cb(); } finally { corked = false; } },
      };
      return { ws, sent, corks: () => corks };
    }

    /** The transport's wrapper: an emitter holding the socket. */
    const wrap = (ws: any) => Object.assign(new EventEmitter(), { ws }) as any;

    it("holds while corked and sends it all in one cork, in order", () => {
      const fake = fakeUWS();
      const client = new uWebSocketClient("s", wrap(fake.ws));

      client.raw(new Uint8Array([0]));
      client.cork();
      client.raw(new Uint8Array([1]));
      client.raw(new Uint8Array([2, 2]));
      client.raw(new Uint8Array([3]));
      assert.strictEqual(fake.sent.length, 1, "nothing goes out while corked");
      client.uncork();
      client.raw(new Uint8Array([4]));

      assert.deepStrictEqual(fake.sent.map((s) => s.bytes), [[0], [1], [2, 2], [3], [4]]);
      assert.deepStrictEqual(fake.sent.map((s) => s.corked), [false, true, true, true, false]);
      assert.strictEqual(fake.corks(), 1);
    });

    it("a window holding one frame sends it as raw() would, without a cork", () => {
      const fake = fakeUWS();
      const client = new uWebSocketClient("s", wrap(fake.ws));
      client.cork();
      client.raw(new Uint8Array([7]));
      client.uncork();
      assert.deepStrictEqual(fake.sent, [{ bytes: [7], corked: false }]);
      assert.strictEqual(fake.corks(), 0);
    });

    it("an empty window sends nothing, and a closed socket drops what was held", () => {
      const fake = fakeUWS();
      const client = new uWebSocketClient("s", wrap(fake.ws));
      client.cork();
      client.uncork();
      assert.strictEqual(fake.corks(), 0);

      client.cork();
      client.raw(new Uint8Array([1]));
      client.readyState = 3; // CLOSED
      client.uncork();
      assert.strictEqual(fake.sent.length, 0);

      client.readyState = 1; // and the next window starts empty
      client.cork();
      client.raw(new Uint8Array([2]));
      client.uncork();
      assert.deepStrictEqual(fake.sent.map((s) => s.bytes), [[2]]);
    });
  });

  describe("h3-transport", () => {
    /** A client on a session that never opens nor closes (the writers are set by hand), what reaches it logged. */
    function fakeH3() {
      const never = new Promise<any>(() => {});
      const log: string[] = [];
      const writes: Uint8Array[] = [];
      const session = { ready: never, closed: never, datagrams: { maxDatagramSize: 0 }, close() { log.push("close"); } };
      const client = new H3Client(session as any, () => {});
      (client as any)._bidiWriter = { write(bytes: Uint8Array) { writes.push(bytes.slice()); log.push(`stream ${bytes.byteLength}`); } };
      (client as any)._datagramWriter = { write(bytes: Uint8Array) { log.push(`datagram ${bytes.byteLength}`); } };
      client.readyState = 1;
      return { client, log, writes };
    }

    it("writes what was held as one write of length-prefixed frames", () => {
      const { client, writes } = fakeH3();

      client.cork();
      const frames = [new Uint8Array([1]), new Uint8Array(300).fill(7), new Uint8Array([3, 3])];
      for (const f of frames) { client.raw(f); }
      assert.strictEqual(writes.length, 0);
      client.uncork();
      assert.strictEqual(writes.length, 1);

      // read back as the client's reader does
      const out = new FrameReassembler().push(writes[0]).map((f) => Array.from(f));
      assert.deepStrictEqual(out, frames.map((f) => Array.from(f)));

      // uncorked, each frame is its own write again
      client.raw(new Uint8Array([9]));
      assert.strictEqual(writes.length, 2);
    });

    it("leave() writes what was held before it closes the session", () => {
      const { client, log } = fakeH3();

      client.cork();
      client.raw(new Uint8Array([1]));
      client.raw(new Uint8Array([2, 2]));
      client.leave(CloseCode.CONSENTED);
      assert.deepStrictEqual(log, ["stream 5", "close"], "both frames, each with its 1-byte prefix, then the close");

      client.uncork(); // the window's own close: nothing left
      assert.deepStrictEqual(log, ["stream 5", "close"]);
    });

    // an `@unreliable` flush mutates what the reliable patch just added: the patch must be on the stream first
    it("a datagram sent mid-window goes after the frames held before it, and the window keeps holding", () => {
      const { client, log } = fakeH3();

      client.cork();
      client.raw(new Uint8Array([1]));
      client.raw(new Uint8Array([2, 2]));
      client.rawUnreliable(new Uint8Array([9]));
      client.raw(new Uint8Array([3]));
      assert.deepStrictEqual(log, ["stream 5", "datagram 2"]);

      client.uncork();
      assert.deepStrictEqual(log, ["stream 5", "datagram 2", "stream 2"]);
    });
  });

});

import assert from "assert";

import { Client as SDKClient } from "@colyseus/sdk";
import { InputEncoder } from "@colyseus/schema/input";
import { schema, t, type SchemaType } from "@colyseus/schema";

import { matchMaker, Room, Server, Transport, Protocol, type Presence, type MatchMakerDriver } from "@colyseus/core";
import { DRIVERS, PRESENCE_IMPLEMENTATIONS, timeout } from "../utils/index.ts";

import { WebSocketTransport } from "@colyseus/ws-transport";

const TEST_PORT = 8571;
const TEST_ENDPOINT = `ws://localhost:${TEST_PORT}`;

// Plain input — for "latest at tick" tests.
const MoveInput = schema({
  x: t.number().default(0),
  y: t.number().default(0),
  jump: t.boolean().default(false),
});
type MoveInput = SchemaType<typeof MoveInput>;

// Sequenced input — exercises framework-level dedupe via inputOptions.seqField.
const SeqInput = schema({
  seq: t.number().default(0),
  x: t.number().default(0),
});
type SeqInput = SchemaType<typeof SeqInput>;

/**
 * Build a ROOM_INPUT_UNRELIABLE packet from `mutators`. The final encoder
 * output already contains the framed ring of all snapshots staged so far.
 */
function unreliableRingPacket<I extends object>(
  Ctor: new () => I,
  mutators: Array<(inst: I) => void>,
): Uint8Array {
  const inst = new Ctor();
  const encoder = new InputEncoder(inst as any, { mode: "unreliable", historySize: mutators.length });
  let last: Uint8Array = new Uint8Array(0);
  for (const m of mutators) { m(inst); last = encoder.encode(); }
  const framed = new Uint8Array(1 + last.length);
  framed[0] = Protocol.ROOM_INPUT_UNRELIABLE;
  framed.set(last, 1);
  return framed;
}

describe("Input (InputEncoder / InputDecoder integration)", () => {
  let driver: MatchMakerDriver;
  let server: Server;
  let presence: Presence;
  let transport: Transport;

  const client = new SDKClient(TEST_ENDPOINT);

  before(async () => {
    driver = new DRIVERS[0]();
    presence = new PRESENCE_IMPLEMENTATIONS[0]();
    transport = new WebSocketTransport();
    server = new Server({
      greet: false,
      gracefullyShutdown: false,
      presence,
      driver,
      transport,
    });
    await matchMaker.setup(presence, driver);
    await server.listen(TEST_PORT);
  });

  beforeEach(async () => {
    await matchMaker.stats.reset();
    await driver.clear();
  });

  after(async () => {
    await driver.clear();
    await server.gracefullyShutdown(false);
  });

  it("Tier 1 — room.input(sessionId).latest returns the latest decoded instance at tick time", async () => {
    let observedAtTick: { x: number; y: number; jump: boolean } | undefined;

    matchMaker.defineRoomType('input_latest', class _ extends Room<{ input: MoveInput }> {
      input = this.defineInput(MoveInput);

      onCreate() {
        this.setSimulationInterval(() => {
          for (const c of this.clients) {
            const latest = this.input(c.sessionId).latest;
            if (latest) observedAtTick = { x: latest.x, y: latest.y, jump: latest.jump };
          }
        }, 30);
      }
    });

    const conn = await client.joinOrCreate('input_latest');
    const input = conn.input({ type: MoveInput });

    input.data.x = 1; input.data.y = 2; input.send();
    await timeout(50);
    assert.deepStrictEqual(observedAtTick, { x: 1, y: 2, jump: false });

    input.data.x = 3; input.data.jump = true; input.send();
    await timeout(50);
    assert.deepStrictEqual(observedAtTick, { x: 3, y: 2, jump: true });

    await conn.leave();
    await timeout(50);
  });

  it("Tier 2 — room.input(sessionId).drain() returns cloned snapshots in arrival order", async () => {
    const drained: number[][] = [];

    matchMaker.defineRoomType('input_drain', class _ extends Room<{ input: MoveInput }> {
      input = this.defineInput(MoveInput, { bufferMaxSize: 16 });
      onCreate() {
        // tick after the test sends; just a manual access pattern
        this.setSimulationInterval(() => {
          for (const c of this.clients) {
            const buf = this.input(c.sessionId).drain();
            if (buf.length > 0) drained.push(buf.map(i => i.x));
          }
        }, 30);
      }
    });

    const conn = await client.joinOrCreate('input_drain');
    const input = conn.input({ type: MoveInput });

    // Two distinct flushes between simulation ticks should both land in the buffer.
    input.data.x = 10; input.send();
    input.data.x = 20; input.send();

    await timeout(80);

    // Both snapshots arrived before the next tick — collected in one drain.
    const flat = drained.flat();
    assert.deepStrictEqual(flat, [10, 20], `expected [10, 20], got ${JSON.stringify(drained)}`);

    await conn.leave();
    await timeout(50);
  });

  it("Tier 2 — drain() snapshots are independent (don't alias the mutating instance)", async () => {
    let captured: MoveInput[] = [];

    matchMaker.defineRoomType('input_clone', class _ extends Room<{ input: MoveInput }> {
      input = this.defineInput(MoveInput, { bufferMaxSize: 16 });
      onCreate() {
        this.setSimulationInterval(() => {
          for (const c of this.clients) {
            captured = captured.concat(this.input(c.sessionId).drain());
          }
        }, 30);
      }
    });

    const conn = await client.joinOrCreate('input_clone');
    const input = conn.input({ type: MoveInput });

    input.data.x = 100; input.send();
    input.data.x = 200; input.send();

    await timeout(80);

    assert.strictEqual(captured.length, 2);
    assert.strictEqual(captured[0].x, 100);
    assert.strictEqual(captured[1].x, 200);
    // Distinct instances:
    assert.notStrictEqual(captured[0], captured[1]);

    await conn.leave();
    await timeout(50);
  });

  it("Tier 2 — inputOptions.seqField dedupes redundant unreliable frames", async () => {
    const drained: number[] = [];

    matchMaker.defineRoomType('input_dedupe', class _ extends Room<{ input: SeqInput }> {
      input = this.defineInput(SeqInput, { seqField: 'seq', bufferMaxSize: 16 });
      onCreate() {
        this.setSimulationInterval(() => {
          for (const c of this.clients) {
            for (const i of this.input(c.sessionId).drain()) drained.push(i.seq);
          }
        }, 30);
      }
    });

    const conn = await client.joinOrCreate('input_dedupe');

    // First packet: seqs [1, 2, 3]
    conn.connection.send(unreliableRingPacket(SeqInput, [
      (i) => { i.seq = 1; i.x = 11; },
      (i) => { i.seq = 2; i.x = 22; },
      (i) => { i.seq = 3; i.x = 33; },
    ]));

    await timeout(50);

    // Second packet (simulating client's ring resend): [2, 3, 4]
    // 2 and 3 are duplicates and should be dropped.
    conn.connection.send(unreliableRingPacket(SeqInput, [
      (i) => { i.seq = 2; i.x = 22; },
      (i) => { i.seq = 3; i.x = 33; },
      (i) => { i.seq = 4; i.x = 44; },
    ]));

    await timeout(80);

    assert.deepStrictEqual(drained, [1, 2, 3, 4], "framework should dedupe seqs already seen");

    await conn.leave();
    await timeout(50);
  });

  it("Tier 2 — inputBufferMaxSize drops oldest on overflow", async () => {
    let drainedXs: number[] = [];

    matchMaker.defineRoomType('input_overflow', class _ extends Room<{ input: MoveInput }> {
      input = this.defineInput(MoveInput, { bufferMaxSize: 3 }); // tiny ring; framework allocates eagerly on join
      messages = {
        // Test reaches in via a message handler to drain on demand.
        sample: function (this: any, c: any) {
          drainedXs = this.input(c.sessionId).drain().map((i: any) => i.x);
        },
      };
    });

    const conn = await client.joinOrCreate('input_overflow');
    const input = conn.input({ type: MoveInput });

    // 5 distinct flushes — buffer cap is 3, oldest 2 should be evicted.
    for (let i = 1; i <= 5; i++) {
      input.data.x = i;
      input.send();
      await timeout(15);
    }
    await timeout(30);

    conn.send("sample");
    await timeout(50);

    assert.deepStrictEqual(drainedXs, [3, 4, 5], "buffer should hold the 3 newest after overflow");

    await conn.leave();
    await timeout(50);
  });

  it("Tier 2 — setTickedSimulation + room.input(sessionId).at(tick) for tick-aligned retrieval", async () => {
    // Lockstep-style: client sends inputs tagged with a tick number; the server's
    // ticked simulation looks up each client's input "for tick N" each step.
    const observed: Array<{ tick: number; x: number | undefined }> = [];

    matchMaker.defineRoomType('input_ticked', class _ extends Room<{ input: SeqInput }> {
      // Demonstrate the one-line `defineInput` form — `seqField` is type-checked
      // against numeric fields of `SeqInput`.
      input = this.defineInput(SeqInput, { seqField: "seq", bufferMaxSize: 16 });
      onCreate() {
        this.setTickedSimulation((tick) => {
          for (const c of this.clients) {
            const snapshot = this.input(c.sessionId).at(tick);
            observed.push({ tick, x: snapshot?.x });
          }
        }, 30);
      }
    });

    const conn = await client.joinOrCreate('input_ticked');

    // Send a small unreliable ring so the server has inputs for ticks 0..2 buffered.
    conn.connection.send(unreliableRingPacket(SeqInput, [
      (i) => { i.seq = 0; i.x = 100; },
      (i) => { i.seq = 1; i.x = 110; },
      (i) => { i.seq = 2; i.x = 120; },
    ]));

    // Let several ticks elapse so the simulation can pick up inputs at(0), at(1), at(2).
    await timeout(200);

    // Filter the rows for the ticks we care about (the simulation runs continuously).
    const byTick = new Map<number, number | undefined>();
    for (const row of observed) {
      if (!byTick.has(row.tick)) byTick.set(row.tick, row.x);
    }
    assert.strictEqual(byTick.get(0), 100);
    assert.strictEqual(byTick.get(1), 110);
    assert.strictEqual(byTick.get(2), 120);
    // Ticks beyond the buffered range have no input — at() returns undefined.
    assert.strictEqual(byTick.get(3), undefined);

    await conn.leave();
    await timeout(50);
  });

  it("Tier 2 — room.tick getter is readable from outside the ticked-simulation callback", async () => {
    let tickFromCallback: number = -1;
    let tickFromMessage: number = -1;

    matchMaker.defineRoomType('input_tick_getter', class _ extends Room {
      onCreate() {
        this.setTickedSimulation((tick) => {
          tickFromCallback = tick;
        }, 30);
      }
      messages = {
        readTick: function (this: any) { tickFromMessage = this.tick; }
      };
    });

    const conn = await client.joinOrCreate('input_tick_getter');

    // Let the simulation tick several times (30ms × ~5 = 150ms).
    await timeout(150);

    // Read room.tick from a message handler (outside the callback's scope).
    conn.send("readTick");
    await timeout(50);

    assert.ok(tickFromCallback >= 3, `expected tick >= 3 in callback, got ${tickFromCallback}`);
    assert.ok(tickFromMessage  >= 3, `expected tick >= 3 from message, got ${tickFromMessage}`);
    // (Don't compare the two against each other — the simulation keeps ticking
    // between when the message handler runs and the test resumes, so tickFromCallback
    // races ahead of the value tickFromMessage captured.)

    await conn.leave();
    await timeout(50);
  });

  it("Tier 2 — at(seq) still resolves after the simulation has ticked past — rollback-friendly", async () => {
    let probeResult: number | undefined;
    let tickAtProbe: number = -1;

    matchMaker.defineRoomType('input_late', class _ extends Room<{ input: SeqInput }> {
      input = this.defineInput(SeqInput, { seqField: 'seq', bufferMaxSize: 16 });
      onCreate() {
        // Tick without draining — `at(seq)` must still find buffered inputs after the
        // server has advanced past their seq number.
        this.setTickedSimulation(() => {}, 30);
      }
      messages = {
        probeAtSeq2: function (this: any, c: any) {
          tickAtProbe = this.tick;
          probeResult = this.input(c.sessionId).at(2)?.x;
        }
      };
    });

    const conn = await client.joinOrCreate('input_late');

    // Send a single input for seq=2.
    conn.connection.send(unreliableRingPacket(SeqInput, [
      (i) => { i.seq = 2; i.x = 222; },
    ]));

    // Wait long enough that the server's ticked simulation has advanced past 2
    // (30ms × ~5 = 150ms). The buffer cap is 16 so the input is still resident.
    await timeout(150);

    // Probe: server tick should be > 2, but at(2) should still return the input.
    conn.send("probeAtSeq2");
    await timeout(50);

    assert.ok(tickAtProbe >= 3, `expected server to have ticked past 2, got tick=${tickAtProbe}`);
    assert.strictEqual(probeResult, 222,
      "at(seq=2) should still return the buffered input even after the server has ticked past 2");

    await conn.leave();
    await timeout(50);
  });

  it("Reflection — conn.input() with no `type` resolves the schema from the server's handshake", async () => {
    let observedAtTick: { x: number; y: number; jump: boolean } | undefined;

    matchMaker.defineRoomType('input_reflection', class _ extends Room<{ input: MoveInput }> {
      input = this.defineInput(MoveInput);
      onCreate() {
        this.setSimulationInterval(() => {
          for (const c of this.clients) {
            const latest = this.input(c.sessionId).latest;
            if (latest) observedAtTick = { x: latest.x, y: latest.y, jump: latest.jump };
          }
        }, 30);
      }
    });

    const conn = await client.joinOrCreate('input_reflection');
    // No `type` here — schema is reconstructed from server reflection bytes.
    const input = conn.input<MoveInput>();

    input.data.x = 7; input.data.y = 8; input.data.jump = true;
    input.send();
    await timeout(50);

    assert.deepStrictEqual(observedAtTick, { x: 7, y: 8, jump: true });

    await conn.leave();
    await timeout(50);
  });

  it("Reflection — conn.input() with no `type` and no server-side defineInput throws clearly", async () => {
    matchMaker.defineRoomType('input_reflection_absent', class _ extends Room {});

    const conn = await client.joinOrCreate('input_reflection_absent');

    assert.throws(
      () => conn.input(),
      /no input schema available/,
    );

    await conn.leave();
    await timeout(50);
  });

  it("no input declared on the Room — ROOM_INPUT_* packets are silently ignored", async () => {
    matchMaker.defineRoomType('input_unset', class _ extends Room {});

    const conn = await client.joinOrCreate('input_unset');

    const inst = new MoveInput();
    inst.x = 42;
    const bytes = new InputEncoder(inst).encode();
    const framed = new Uint8Array(1 + bytes.length);
    framed[0] = Protocol.ROOM_INPUT_RELIABLE;
    framed.set(bytes, 1);
    conn.connection.send(framed);

    await timeout(80);
    assert.ok(conn.connection.isOpen, "connection should remain open");

    await conn.leave();
    await timeout(50);
  });
});

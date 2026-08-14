import assert from "assert";

import { Client as SDKClient } from "@colyseus/sdk";
import { InputEncoder } from "@colyseus/schema/input";
import { schema, t, MapSchema, type SchemaType } from "@colyseus/schema";

import { matchMaker, Room, Server, Transport, Protocol, type Presence, type MatchMakerDriver } from "@colyseus/core";
import { DRIVERS, PRESENCE_IMPLEMENTATIONS, timeout } from "../utils/index.ts";

import { WebSocketTransport } from "@colyseus/ws-transport";
import { unreliableRing, unreliableRingPacket } from "./ring.ts";

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

// Minimal state — mutated each tick so patches (carrying the consumedCount ack) flow.
const TickState = schema({
  tick: t.number().default(0),
});
type TickState = SchemaType<typeof TickState>;

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

  it("Tier 1 — room.inputs.get(sessionId).latest returns the latest decoded instance at tick time", async () => {
    let observedAtTick: { x: number; y: number; jump: boolean } | undefined;

    matchMaker.defineRoomType('input_latest', class _ extends Room<{ input: MoveInput }> {
      inputs = this.defineInput(MoveInput);

      onCreate() {
        this.setSimulationInterval(() => {
          for (const c of this.clients) {
            const latest = this.inputs.get(c.sessionId).latest;
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

  it("Tier 1 — defineInput({ sanitize }) clamps decoded frames before latest/drain", async () => {
    let observed: { latestX: number; drained: number[] } | undefined;

    matchMaker.defineRoomType('input_sanitize', class _ extends Room<{ input: MoveInput }> {
      inputs = this.defineInput(MoveInput, {
        bufferMaxSize: 16,
        sanitize: { x: [-1, 1] },   // never trust the wire
      });
      onCreate() {
        this.setSimulationInterval(() => {
          for (const c of this.clients) {
            const ch = this.inputs.get(c.sessionId);
            const drained = ch.drain().map((i) => i.x);
            if (drained.length > 0) {
              observed = { latestX: ch.latest!.x, drained };
            }
          }
        }, 30);
      }
    });

    const conn = await client.joinOrCreate('input_sanitize');
    const input = conn.input({ type: MoveInput });

    // A "speed hack" value: way outside the declared [-1, 1] domain.
    input.data.x = 127; input.send();
    await timeout(80);

    assert.deepStrictEqual(observed, { latestX: 1, drained: [1] },
      "both the bound `latest` and the buffered clone see the clamped value");

    await conn.leave();
    await timeout(50);
  });

  it("Tier 2 — room.inputs.get(sessionId).drain() returns cloned snapshots in arrival order", async () => {
    const drained: number[][] = [];

    matchMaker.defineRoomType('input_drain', class _ extends Room<{ input: MoveInput }> {
      inputs = this.defineInput(MoveInput, { bufferMaxSize: 16 });
      onCreate() {
        // tick after the test sends; just a manual access pattern
        this.setSimulationInterval(() => {
          for (const c of this.clients) {
            const buf = this.inputs.get(c.sessionId).drain();
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
      inputs = this.defineInput(MoveInput, { bufferMaxSize: 16 });
      onCreate() {
        this.setSimulationInterval(() => {
          for (const c of this.clients) {
            captured = captured.concat(this.inputs.get(c.sessionId).drain());
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

  it("Tier 2 — the framework wire seq dedupes redundant unreliable ring frames", async () => {
    const drained: number[] = [];

    matchMaker.defineRoomType('input_dedupe', class _ extends Room<{ input: SeqInput }> {
      inputs = this.defineInput(SeqInput, { seqField: 'seq', bufferMaxSize: 16 });
      onCreate() {
        this.setSimulationInterval(() => {
          for (const c of this.clients) {
            for (const i of this.inputs.get(c.sessionId).drain()) drained.push(i.seq);
          }
        }, 30);
      }
    });

    const conn = await client.joinOrCreate('input_dedupe');

    // ONE encoder = one continuous framework wire seq, so the redundancy ring
    // overlaps across packets the way a real client's does. Dedupe keys on that
    // wire seq (not the user `seqField`, which here just mirrors it for a
    // readable assertion).
    const tick = unreliableRing(SeqInput, 3);
    tick((i) => { i.seq = 1; i.x = 11; });
    tick((i) => { i.seq = 2; i.x = 22; });
    const first = tick((i) => { i.seq = 3; i.x = 33; }); // ring carries wire [1,2,3]
    conn.connection.send(first);

    await timeout(50);

    // Sliding the ring one tick resends wire [2,3,4] — 2 and 3 were already seen
    // and are dropped; only seq=4 is new.
    const second = tick((i) => { i.seq = 4; i.x = 44; });
    conn.connection.send(second);

    await timeout(80);

    assert.deepStrictEqual(drained, [1, 2, 3, 4], "framework should dedupe wire seqs already seen");

    await conn.leave();
    await timeout(50);
  });

  it("Tier 2 — inputBufferMaxSize drops oldest on overflow", async () => {
    let drainedXs: number[] = [];

    matchMaker.defineRoomType('input_overflow', class _ extends Room<{ input: MoveInput }> {
      inputs = this.defineInput(MoveInput, { bufferMaxSize: 3 }); // tiny ring; framework allocates eagerly on join
      messages = {
        // Test reaches in via a message handler to drain on demand.
        sample: function (this: any, c: any) {
          drainedXs = this.inputs.get(c.sessionId).drain().map((i: any) => i.x);
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

  it("Tier 2 — next() consumes exactly one (oldest) per call and holds on empty", async () => {
    // Single-consume for a shared-world room: one input per entity per tick.
    let probe: { x: number | undefined; size: number } = { x: -1, size: -1 };

    matchMaker.defineRoomType('input_next', class _ extends Room<{ input: MoveInput }> {
      inputs = this.defineInput(MoveInput, { bufferMaxSize: 16 });
      messages = {
        // No simulation loop — consume on demand so the buffer fills first.
        consumeOne: function (this: any, c: any) {
          const acc = this.inputs.get(c.sessionId);
          const inp = acc.next();
          probe = { x: inp?.x, size: acc.size };
        },
      };
    });

    const conn = await client.joinOrCreate('input_next');
    const input = conn.input({ type: MoveInput });

    // Three inputs buffered before consuming any.
    input.data.x = 10; input.send(); await timeout(15);
    input.data.x = 20; input.send(); await timeout(15);
    input.data.x = 30; input.send(); await timeout(30);

    conn.send("consumeOne"); await timeout(40);
    assert.deepStrictEqual(probe, { x: 10, size: 2 }, "first next() → oldest, two remain");

    conn.send("consumeOne"); await timeout(40);
    assert.deepStrictEqual(probe, { x: 20, size: 1 });

    conn.send("consumeOne"); await timeout(40);
    assert.deepStrictEqual(probe, { x: 30, size: 0 });

    conn.send("consumeOne"); await timeout(40);
    assert.deepStrictEqual(probe, { x: undefined, size: 0 }, "empty buffer → undefined (hold last)");

    await conn.leave();
    await timeout(50);
  });

  it("Tier 2 — take(n) consumes up to n oldest, returning fewer when the buffer is short", async () => {
    let probe: { xs: number[]; size: number } = { xs: [-1], size: -1 };

    matchMaker.defineRoomType('input_take', class _ extends Room<{ input: MoveInput }> {
      inputs = this.defineInput(MoveInput, { bufferMaxSize: 16 });
      messages = {
        takeTwo: function (this: any, c: any) {
          const acc = this.inputs.get(c.sessionId);
          const taken = acc.take(2);
          probe = { xs: taken.map((i: any) => i.x), size: acc.size };
        },
      };
    });

    const conn = await client.joinOrCreate('input_take');
    const input = conn.input({ type: MoveInput });

    for (let i = 1; i <= 5; i++) { input.data.x = i; input.send(); await timeout(15); }
    await timeout(20);

    conn.send("takeTwo"); await timeout(40);
    assert.deepStrictEqual(probe, { xs: [1, 2], size: 3 }, "take(2) → two oldest, three remain");

    conn.send("takeTwo"); await timeout(40);
    assert.deepStrictEqual(probe, { xs: [3, 4], size: 1 });

    conn.send("takeTwo"); await timeout(40);
    assert.deepStrictEqual(probe, { xs: [5], size: 0 }, "take(2) with one left returns just that one");

    conn.send("takeTwo"); await timeout(40);
    assert.deepStrictEqual(probe, { xs: [], size: 0 }, "empty buffer → []");

    await conn.leave();
    await timeout(50);
  });

  it("Tier 2 — next() reports per-consumed-input renderTime (oldest first), not the newest", async () => {
    // Distinguishes next() from drain(): drain() would report the NEWEST stamp on
    // the first call; next() reports the stamp of the one input it consumed.
    const observed: number[] = [];

    matchMaker.defineRoomType('input_next_rt', class _ extends Room<{ input: MoveInput }> {
      inputs = this.defineInput(MoveInput, { bufferMaxSize: 16 });
      // A mode:"snapshot" rewind target auto-enables the renderTime stamp
      // (render-only mode) — the empty collection only sets the timeline.
      rewind = this.allowRewindState();
      onCreate() {
        this.rewind.attachAll(new MapSchema<MoveInput>(), { fields: ["x"], mode: "snapshot" });
      }
      messages = {
        consumeOne: function (this: any, c: any) {
          const acc = this.inputs.get(c.sessionId);
          const inp = acc.next();
          observed.push(inp ? acc.renderTime : -1);
        },
      };
    });

    const conn = await client.joinOrCreate('input_next_rt');
    const input = conn.input({ type: MoveInput }); // render-only stamping (server advertised it via the snapshot rewind)

    // Drive the SDK's REAL reliable-input encoder so the wire stamp (delta-coded)
    // comes from production code, not a hand-framed packet. A controllable clock
    // feeds exact render stamps: renderTime = round(serverNow()) − renderDelta, and
    // here renderDelay/rtt are 0 so the stamp equals `now`. lastServerTime() > 0
    // marks the clock "synced" so the SDK actually stamps (vs 0 before sync).
    let now = 0;
    conn.clock = {
      now: () => now, serverNow: () => now, rtt: () => 0, smoothedRtt: () => 0,
      lastServerTime: () => 1, setPatchInterval: () => {}, sample: () => {},
    } as any;

    // Three reliable inputs with KNOWN, increasing render-time stamps.
    for (const stamp of [100, 200, 300]) {
      now = stamp;
      input.data.x = stamp / 100;
      input.send();
      await timeout(20);
    }
    await timeout(20);

    conn.send("consumeOne"); await timeout(40);
    conn.send("consumeOne"); await timeout(40);
    conn.send("consumeOne"); await timeout(40);

    assert.deepStrictEqual(observed, [100, 200, 300],
      "next() must report the consumed input's own renderTime, advancing oldest→newest");

    await conn.leave();
    await timeout(50);
  });

  it("Tier 2 — next() advances the reconcile ack echoed to the client as lastProcessed", async () => {
    // consumedCount accounting end-to-end: each next() bumps the buffer's consumed
    // counter, which the serializer echoes in the TIMED prefix; the SDK surfaces it
    // as input.lastProcessed.
    matchMaker.defineRoomType('input_next_ack', class _ extends Room<{ input: MoveInput; state: TickState }> {
      state = new TickState();
      inputs = this.defineInput(MoveInput, { bufferMaxSize: 64 });
      onCreate() {
        this.setFixedTimestep(() => {
          for (const c of this.clients) { this.inputs.get(c.sessionId).next(); } // ack +1 per tick
          this.state.tick++; // mutate so patches (carrying the ack) flow
        }, 30);
      }
    });

    const conn = await client.joinOrCreate('input_next_ack');
    const input = conn.input({ type: MoveInput });

    const N = 5;
    for (let i = 1; i <= N; i++) { input.data.x = i; input.send(); await timeout(15); }

    // Let the fixed-timestep loop consume every buffered input one-per-tick.
    await timeout(300);

    assert.strictEqual(input.lastProcessed, N,
      `server should have consumed all ${N} inputs one-per-tick; got lastProcessed=${input.lastProcessed}`);

    await conn.leave();
    await timeout(50);
  });

  it("Tier 2 — iterating room.inputs.get(sessionId) consumes all pending and advances the ack", async () => {
    // Per-entity standard loop: `for (const inp of this.inputs.get(sid))` consumes the
    // whole pending set this tick (Array.from drains the iterator), so lastProcessed
    // reaches N once the inputs land — same wire ack as drain(), per-input internally.
    matchMaker.defineRoomType('input_consume_ack', class _ extends Room<{ input: MoveInput; state: TickState }> {
      state = new TickState();
      inputs = this.defineInput(MoveInput, { bufferMaxSize: 64 });
      onCreate() {
        this.setFixedTimestep(() => {
          for (const c of this.clients) { Array.from(this.inputs.get(c.sessionId)); } // drain via iteration
          this.state.tick++; // mutate so patches (carrying the ack) flow
        }, 30);
      }
    });

    const conn = await client.joinOrCreate('input_consume_ack');
    const input = conn.input({ type: MoveInput });

    const N = 5;
    for (let i = 1; i <= N; i++) { input.data.x = i; input.send(); await timeout(15); }
    await timeout(200);

    assert.strictEqual(input.lastProcessed, N,
      `iterating should consume all ${N}; got lastProcessed=${input.lastProcessed}`);

    await conn.leave();
    await timeout(50);
  });

  it("Tier 2 — iteration is empty for bufferMaxSize:0 and unknown sessionIds", async () => {
    let probe: { own: number; unknown: number } = { own: -1, unknown: -1 };

    matchMaker.defineRoomType('input_consume_empty', class _ extends Room<{ input: MoveInput }> {
      inputs = this.defineInput(MoveInput, { bufferMaxSize: 0 }); // no buffer → .latest only
      messages = {
        probe: function (this: any, c: any) {
          probe = {
            own: Array.from(this.inputs.get(c.sessionId)).length,
            unknown: Array.from(this.inputs.get("does-not-exist")).length,
          };
        },
      };
    });

    const conn = await client.joinOrCreate('input_consume_empty');
    const input = conn.input({ type: MoveInput });
    input.data.x = 1; input.send(); await timeout(20);

    conn.send("probe"); await timeout(40);
    assert.deepStrictEqual(probe, { own: 0, unknown: 0 },
      "no buffer / unknown sid → zero iterations");

    await conn.leave();
    await timeout(50);
  });

  it("Tier 2 — setFixedTimestep + room.inputs.get(sessionId).at(tick) for tick-aligned retrieval", async () => {
    // Lockstep-style: client sends inputs tagged with a tick number; the server's
    // fixed-timestep simulation looks up each client's input "for tick N" each step.
    const observed: Array<{ tick: number; x: number | undefined }> = [];

    matchMaker.defineRoomType('input_ticked', class _ extends Room<{ input: SeqInput }> {
      // Demonstrate the one-line `defineInput` form — `seqField` is type-checked
      // against numeric fields of `SeqInput`.
      inputs = this.defineInput(SeqInput, { seqField: "seq", bufferMaxSize: 16 });
      onCreate() {
        this.setFixedTimestep((ctx) => {
          for (const c of this.clients) {
            const snapshot = this.inputs.get(c.sessionId).at(ctx.tick);
            observed.push({ tick: ctx.tick, x: snapshot?.x });
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

  it("Tier 2 — at(seq) still resolves after the simulation has ticked past — rollback-friendly", async () => {
    let probeResult: number | undefined;
    let tickAtProbe: number = -1;
    let serverTick: number = -1; // latest ctx.tick, captured for the message probe

    matchMaker.defineRoomType('input_late', class _ extends Room<{ input: SeqInput }> {
      inputs = this.defineInput(SeqInput, { seqField: 'seq', bufferMaxSize: 16 });
      onCreate() {
        // Tick without draining — `at(seq)` must still find buffered inputs after the
        // server has advanced past their seq number.
        this.setFixedTimestep((ctx) => { serverTick = ctx.tick; }, 30);
      }
      messages = {
        probeAtSeq2: function (this: any, c: any) {
          tickAtProbe = serverTick;
          probeResult = this.inputs.get(c.sessionId).at(2)?.x;
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
      inputs = this.defineInput(MoveInput);
      onCreate() {
        this.setSimulationInterval(() => {
          for (const c of this.clients) {
            const latest = this.inputs.get(c.sessionId).latest;
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

  it("sub-stepping — setFixedTimestep({ subSteps }) cascades N + sub-step dt to the client handle", async () => {
    let serverCtx: { dt: number; subSteps: number; subDt: number; subDtMs: number } | undefined;
    let serverApi: { subSteps: number; subStepSeconds?: number; subStepMs?: number } | undefined;

    matchMaker.defineRoomType('input_substeps', class _ extends Room<{ input: MoveInput }> {
      inputs = this.defineInput(MoveInput);
      onCreate() {
        // 30 inputs/sec on the wire; physics meant to integrate 2 × subDt per step.
        this.setFixedTimestep((ctx) => {
          serverCtx = { dt: ctx.dt, subSteps: ctx.subSteps, subDt: ctx.subDt, subDtMs: ctx.subDtMs };
        }, 30, { subSteps: 2 });
        serverApi = { subSteps: this.inputs.subSteps, subStepSeconds: this.inputs.subStepSeconds, subStepMs: this.inputs.subStepMs };
      }
    });

    const conn = await client.joinOrCreate('input_substeps');
    const input = conn.input({ type: MoveInput });

    // Client handle mirrors the single server-side declaration.
    assert.strictEqual(input.tickRate, 30);
    assert.strictEqual(input.subSteps, 2);
    assert.strictEqual(input.stepSeconds, 1 / 30);
    assert.strictEqual(input.subStepSeconds, (1 / 30) / 2);
    assert.strictEqual(input.subStepMs, (1000 / 30) / 2);

    await timeout(80); // ≥ one fixed step at 30 Hz
    assert.ok(serverCtx, "fixed step ran");
    assert.strictEqual(serverCtx!.subSteps, 2);
    assert.strictEqual(serverCtx!.dt, input.stepSeconds, "per-step dt bit-identical on both sides");
    assert.strictEqual(serverCtx!.subDt, input.subStepSeconds, "per-SUB-step dt bit-identical on both sides");
    assert.strictEqual(serverCtx!.subDtMs, input.subStepMs);

    // Server-side InputAPI mirrors the same trio.
    assert.deepStrictEqual(serverApi, { subSteps: 2, subStepSeconds: (1 / 30) / 2, subStepMs: (1000 / 30) / 2 });

    await conn.leave();
    await timeout(50);
  });

  it("sub-stepping — defaults to 1 when not declared (flag stays off the wire)", async () => {
    matchMaker.defineRoomType('input_substeps_default', class _ extends Room<{ input: MoveInput }> {
      inputs = this.defineInput(MoveInput);
      onCreate() {
        this.setFixedTimestep(() => {}, 30);
      }
    });

    const conn = await client.joinOrCreate('input_substeps_default');
    const input = conn.input({ type: MoveInput });

    assert.strictEqual(input.tickRate, 30);
    assert.strictEqual(input.subSteps, 1);
    assert.strictEqual(input.subStepSeconds, input.stepSeconds, "subDt degenerates to dt when not sub-stepping");

    await conn.leave();
    await timeout(50);
  });

  it("sub-stepping — rejects fractional counts loudly", async () => {
    assert.throws(() => {
      class _ extends Room<{ input: MoveInput }> {
        inputs = this.defineInput(MoveInput, { subSteps: 1.5 });
      }
      new _();
    }, /subSteps must be an integer/);
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

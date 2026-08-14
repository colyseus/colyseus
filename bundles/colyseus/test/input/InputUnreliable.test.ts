import assert from "assert";

import { Client as SDKClient } from "@colyseus/sdk";
import { schema, t, encode, MapSchema, type SchemaType } from "@colyseus/schema";

import { matchMaker, Room, Server, Transport, Protocol, ProtocolModifier, type Presence, type MatchMakerDriver } from "@colyseus/core";
import { DRIVERS, timeout } from "../utils/index.ts";

import { WebSocketTransport } from "@colyseus/ws-transport";
import { unreliableRing } from "./ring.ts";

const TEST_PORT = 8574;
const TEST_ENDPOINT = `ws://localhost:${TEST_PORT}`;

const SeqInput = schema({
  seq: t.number().default(0),
  x: t.number().default(0),
});
type SeqInput = SchemaType<typeof SeqInput>;

const TickState = schema({
  tick: t.number().default(0),
});
type TickState = SchemaType<typeof TickState>;

const Enemy = schema({ x: t.number().default(0) }, "UnrelEnemy");
type Enemy = SchemaType<typeof Enemy>;

/** State with a rewindable collection — a reckon-mode group is what makes the
 *  server ask clients to stamp their inputs. */
const LagState = schema({
  tick: t.number().default(0),
  enemies: t.map(Enemy).default(new MapSchema<Enemy>()),
  props: t.map(Enemy).default(new MapSchema<Enemy>()),
});
type LagState = SchemaType<typeof LagState>;

describe("unreliable input (client→server)", () => {
  let driver: MatchMakerDriver;
  let server: Server;
  let presence: Presence;
  let transport: Transport;

  const client = new SDKClient(TEST_ENDPOINT);

  before(async () => {
    driver = new DRIVERS[0]();
    presence = new (await import("@colyseus/core")).LocalPresence();
    transport = new WebSocketTransport();
    server = new Server({ greet: false, gracefullyShutdown: false, presence, driver, transport });
    await server.listen(TEST_PORT);
  });

  after(async () => {
    await server.gracefullyShutdown(false);
  });

  beforeEach(async () => {
    await matchMaker.setup(presence, driver);
    await matchMaker.stats.reset();
  });

  afterEach(async () => {
    await matchMaker.disconnectAll();
  });

  /** Room that records every consumed input's `seq`, plus the ack it echoes. */
  function defineRecordingRoom(name: string, historySizeHint = 16) {
    const drained: number[] = [];
    matchMaker.defineRoomType(name, class _ extends Room<{ state: TickState; input: SeqInput }> {
      state = new TickState();
      inputs = this.defineInput(SeqInput, { bufferMaxSize: historySizeHint });
      onCreate() {
        this.setSimulationInterval(() => {
          this.state.tick++;
          for (const c of this.clients) {
            for (const i of this.inputs.get(c.sessionId).drain()) { drained.push(i.seq); }
          }
        }, 25);
      }
    });
    return drained;
  }

  describe("redundancy ring", () => {
    it("recovers inputs from a dropped packet via the following packet's overlap", async () => {
      const drained = defineRecordingRoom("unrel_loss");
      const conn = await client.joinOrCreate("unrel_loss");

      const tick = unreliableRing(SeqInput, 3);
      const p1 = tick((i) => { i.seq = 1; });
      tick((i) => { i.seq = 2; });
      tick((i) => { i.seq = 3; });
      const p4 = tick((i) => { i.seq = 4; }); // ring [2,3,4]

      // Deliver 1 and 4 only — packets 2 and 3 are "lost". Their inputs still
      // arrive, carried redundantly inside 4.
      conn.connection.send(p1);
      await timeout(60);
      conn.connection.send(p4);
      await timeout(80);

      assert.deepStrictEqual(drained, [1, 2, 3, 4],
        "the ring must reconstruct the seqs whose own packets were dropped");

      await conn.leave();
      await timeout(50);
    });

    it("loses inputs only when the gap exceeds historySize, and never desyncs", async () => {
      const drained = defineRecordingRoom("unrel_gap");
      const conn = await client.joinOrCreate("unrel_gap");

      const tick = unreliableRing(SeqInput, 2); // only 2 slots of redundancy
      const p1 = tick((i) => { i.seq = 1; });
      tick((i) => { i.seq = 2; });
      tick((i) => { i.seq = 3; });
      tick((i) => { i.seq = 4; });
      const p5 = tick((i) => { i.seq = 5; }); // ring [4,5] — 2 and 3 are gone

      conn.connection.send(p1);
      await timeout(60);
      conn.connection.send(p5);
      await timeout(80);

      assert.deepStrictEqual(drained, [1, 4, 5],
        "seqs beyond the ring are genuinely lost — but the stream continues cleanly");

      await conn.leave();
      await timeout(50);
    });
  });

  describe("out-of-order and duplicate delivery", () => {
    it("drops a packet that arrives after a newer one, without replaying old inputs", async () => {
      const drained = defineRecordingRoom("unrel_reorder");
      const conn = await client.joinOrCreate("unrel_reorder");

      const tick = unreliableRing(SeqInput, 3);
      const p1 = tick((i) => { i.seq = 1; });
      const p2 = tick((i) => { i.seq = 2; }); // ring [1,2]
      tick((i) => { i.seq = 3; });
      const p4 = tick((i) => { i.seq = 4; }); // ring [2,3,4]

      conn.connection.send(p1);
      await timeout(50);
      conn.connection.send(p4);   // jumps ahead: carries [2,3,4]
      await timeout(50);
      conn.connection.send(p2);   // late straggler: carries [1,2] — all stale
      await timeout(80);

      assert.deepStrictEqual(drained, [1, 2, 3, 4],
        "a late packet must not re-deliver seqs already consumed");

      await conn.leave();
      await timeout(50);
    });

    it("ignores an exact duplicate packet", async () => {
      const drained = defineRecordingRoom("unrel_dup");
      const conn = await client.joinOrCreate("unrel_dup");

      const tick = unreliableRing(SeqInput, 3);
      const p1 = tick((i) => { i.seq = 1; });
      const p2 = tick((i) => { i.seq = 2; });

      conn.connection.send(p1);
      await timeout(50);
      conn.connection.send(p2);
      await timeout(50);
      conn.connection.send(p2);   // duplicated by the network
      await timeout(80);

      assert.deepStrictEqual(drained, [1, 2], "a duplicate must be consumed exactly once");

      await conn.leave();
      await timeout(50);
    });
  });

  describe("reconciliation ack under loss", () => {
    it("acks the seq VALUE, so the client's pending set drains across a gap", async () => {
      defineRecordingRoom("unrel_ack");
      const conn = await client.joinOrCreate("unrel_ack");

      // The handle must exist before the ack lands — `Room` drops the TIMED
      // ack when no input handle has been created yet.
      const handle = conn.input<SeqInput>({ type: SeqInput as any, mode: "unreliable", historySize: 3 });

      const tick = unreliableRing(SeqInput, 3);
      tick((i) => { i.seq = 1; });
      tick((i) => { i.seq = 2; });
      tick((i) => { i.seq = 3; });
      tick((i) => { i.seq = 4; });
      const p5 = tick((i) => { i.seq = 5; });

      // Only the newest packet lands: the server consumes seqs 3,4,5 and has
      // never seen 1 or 2. If the ack were a COUNT it would report 3, leaving
      // the client believing seqs 4 and 5 are still in flight forever.
      conn.connection.send(p5);
      await timeout(120);

      assert.strictEqual(handle.lastProcessed, 5,
        "ack must be the wire seq value, not the number consumed");

      await conn.leave();
      await timeout(50);
    });
  });

  describe("transport without a datagram channel", () => {
    it("sends unreliable traffic reliably rather than dropping it", async () => {
      const drained = defineRecordingRoom("unrel_ws");
      const conn = await client.joinOrCreate("unrel_ws");

      // This suite runs on WebSocketTransport — no unreliable channel, so the
      // ring rides the ordered one and the server dedupes it as usual.
      const handle = conn.input<SeqInput>({ type: SeqInput as any, mode: "unreliable", historySize: 3 });
      for (let i = 1; i <= 5; i++) {
        handle.data.seq = i;
        handle.send();
        await timeout(30);
      }
      await timeout(120);

      assert.deepStrictEqual(drained, [1, 2, 3, 4, 5],
        "every input must still reach the server, exactly once");

      // And the reconciliation loop closes — the symptom of the old silent
      // drop was a pending set that grew forever.
      assert.strictEqual(handle.sentCount, 5);
      assert.strictEqual(handle.lastProcessed, 5, "the server acked them");
      assert.strictEqual(handle.pendingCount, 0, "pending drains");

      await conn.leave();
      await timeout(50);
    });

  });

  //
  // `mode` is a delivery choice, not a lag-comp choice: a rewinding room stamps
  // these inputs too. The stamp block is per-slot and self-contained precisely
  // so an input recovered from the redundancy ring keeps its own instant.
  //
  describe("lag-comp stamps", () => {
    it("carries a per-slot stamp that survives a dropped packet", async () => {
      const seen: Array<{ seq: number; reckon: number }> = [];

      matchMaker.defineRoomType("unrel_stamps", class _ extends Room<{ state: LagState; input: SeqInput }> {
        state = new LagState();
        inputs = this.defineInput(SeqInput, { bufferMaxSize: 16 });
        rewind = this.allowRewindState({ maxRewindMs: 500 });
        onCreate() {
          this.state.enemies.set("a", new Enemy());
          this.rewind.attachAll(this.state.enemies, { fields: ["x"], mode: "reckon" });
          this.setSimulationInterval(() => {
            this.state.tick++;
            for (const c of this.clients) {
              const ch = this.inputs.get(c.sessionId);
              let inp = ch.next();
              while (inp !== undefined) {
                seen.push({ seq: (inp as any).seq, reckon: (c as any)._inputBuffer.reckonTime });
                inp = ch.next();
              }
            }
          }, 25);
        }
      });

      const conn = await client.joinOrCreate("unrel_stamps");
      const handle = conn.input<SeqInput>({ type: SeqInput as any, mode: "unreliable", historySize: 4 });

      // Let the clock sync — an unsynced client stamps 0 by design.
      await timeout(300);

      for (let i = 1; i <= 6; i++) {
        handle.data.seq = i;
        handle.send();
        await timeout(30);
      }
      await timeout(150);

      assert.strictEqual(seen.length, 6, "every input consumed once");
      for (const s of seen) {
        assert.ok(s.reckon > 0, `seq ${s.seq} must carry a reckon stamp (got ${s.reckon})`);
      }
      // Stamps advance with the inputs — not one value smeared across the ring.
      const first = seen[0].reckon, last = seen[seen.length - 1].reckon;
      assert.ok(last > first, `stamps must advance across the stream (${first} → ${last})`);

      await conn.leave();
      await timeout(50);
    });

    it("keeps stamps when a packet is dropped and its inputs arrive redundantly", async () => {
      const seen: Array<{ seq: number; reckon: number }> = [];

      matchMaker.defineRoomType("unrel_stamp_loss", class _ extends Room<{ state: LagState; input: SeqInput }> {
        state = new LagState();
        inputs = this.defineInput(SeqInput, { bufferMaxSize: 16 });
        rewind = this.allowRewindState({ maxRewindMs: 500 });
        onCreate() {
          this.state.enemies.set("a", new Enemy());
          this.rewind.attachAll(this.state.enemies, { fields: ["x"], mode: "reckon" });
          this.setSimulationInterval(() => {
            this.state.tick++;
            for (const c of this.clients) {
              const ch = this.inputs.get(c.sessionId);
              let inp = ch.next();
              while (inp !== undefined) {
                seen.push({ seq: (inp as any).seq, reckon: (c as any)._inputBuffer.reckonTime });
                inp = ch.next();
              }
            }
          }, 25);
        }
      });

      const conn = await client.joinOrCreate("unrel_stamp_loss");
      const handle = conn.input<SeqInput>({ type: SeqInput as any, mode: "unreliable", historySize: 4 });
      await timeout(300);

      // Capture the frames instead of transmitting them, so loss is exact.
      const packets: Uint8Array[] = [];
      const conn2: any = conn.connection;
      const realSendUnreliable = conn2.sendUnreliable.bind(conn2);
      conn2.sendUnreliable = (d: Uint8Array) => { packets.push(d.slice()); };

      for (let i = 1; i <= 4; i++) { handle.data.seq = i; handle.send(); await timeout(20); }
      conn2.sendUnreliable = realSendUnreliable;

      // Deliver ONLY the last packet: seqs 1-3's own packets are lost, and they
      // arrive redundantly inside it — each with its own stamp.
      conn.connection.send(packets[packets.length - 1]);
      await timeout(150);

      assert.deepStrictEqual(seen.map((s) => s.seq), [1, 2, 3, 4],
        "the ring recovers all four");
      for (const s of seen) {
        assert.ok(s.reckon > 0,
          `seq ${s.seq} must keep its stamp even though its own packet was dropped (got ${s.reckon})`);
      }
      const stamps = seen.map((s) => s.reckon);
      assert.deepStrictEqual([...stamps].sort((a, b) => a - b), stamps,
        "recovered stamps must stay in send order");

      await conn.leave();
      await timeout(50);
    });

    it("BOTH mode: the server reconstructs a per-slot renderDelta", async () => {
      const seen: Array<{ seq: number; reckon: number; render: number }> = [];

      matchMaker.defineRoomType("unrel_both", class _ extends Room<{ state: LagState; input: SeqInput }> {
        state = new LagState();
        inputs = this.defineInput(SeqInput, { bufferMaxSize: 16 });
        rewind = this.allowRewindState({ maxRewindMs: 5000 });
        onCreate() {
          // One group of each timeline ⇒ BOTH flags ⇒ the renderDelta series.
          this.state.enemies.set("a", new Enemy());
          this.state.props.set("p", new Enemy());
          this.rewind.attachAll(this.state.enemies, { fields: ["x"], mode: "reckon" });
          this.rewind.attachAll(this.state.props, { fields: ["x"], mode: "snapshot" });
          this.setSimulationInterval(() => {
            this.state.tick++;
            for (const c of this.clients) {
              const ch = this.inputs.get(c.sessionId);
              let inp = ch.next();
              while (inp !== undefined) {
                const buf = (c as any)._inputBuffer;
                seen.push({ seq: (inp as any).seq, reckon: buf.reckonTime, render: buf.renderTime });
                inp = ch.next();
              }
            }
          }, 25);
        }
      });

      const conn = await client.joinOrCreate("unrel_both");
      // Handle exists so the room treats this as an input client.
      const h = conn.input<SeqInput>({ type: SeqInput as any, mode: "unreliable", historySize: 3 });
      assert.strictEqual((h as any)._stampReckon && (h as any)._stampRender, true,
        "one group of each timeline ⇒ BOTH mode");

      // Hand-built packet with KNOWN per-slot values, so the assertion is on the
      // reader alone (the writer is covered by the SDK's input-handle tests).
      const tick = unreliableRing(SeqInput, 3);
      tick((i) => { i.seq = 1; });
      tick((i) => { i.seq = 2; });
      const ringPacket = tick((i) => { i.seq = 3; });
      const ringBody = ringPacket.subarray(1);

      const stamps = [1000, 1050, 1100];   // oldest → newest
      const rds = [10, 20, 30];            // deliberately different per slot

      const block = new Uint8Array(64);
      const bit = { offset: 0 };
      encode.number(block, stamps.length, bit);
      encode.uint32(block, stamps[2], bit);
      encode.number(block, stamps[2] - stamps[1], bit);
      encode.number(block, stamps[1] - stamps[0], bit);
      encode.uint16(block, rds[2], bit);
      encode.number(block, rds[2] - rds[1], bit);
      encode.number(block, rds[1] - rds[0], bit);

      const framed = new Uint8Array(1 + bit.offset + ringBody.length);
      framed[0] = Protocol.ROOM_INPUT_UNRELIABLE | ProtocolModifier.TIMED;
      framed.set(block.subarray(0, bit.offset), 1);
      framed.set(ringBody, 1 + bit.offset);

      conn.connection.send(framed);
      await timeout(150);

      assert.deepStrictEqual(seen.map((s) => s.seq), [1, 2, 3]);
      assert.deepStrictEqual(seen.map((s) => s.reckon), stamps);
      // renderTime = reckonTime − that slot's OWN renderDelta. A per-packet
      // value would give [1070, 1070, 1070]'s shape here instead.
      assert.deepStrictEqual(seen.map((s) => s.render), [990, 1030, 1070]);

      await conn.leave();
      await timeout(50);
    });

    it("legacy: an unstamped unreliable packet still reads live", async () => {
      let stampedReckon: number | undefined;

      matchMaker.defineRoomType("unrel_lagcomp", class _ extends Room<{ state: LagState; input: SeqInput }> {
        state = new LagState();
        inputs = this.defineInput(SeqInput, { bufferMaxSize: 16 });
        rewind = this.allowRewindState({ maxRewindMs: 500 });
        onCreate() {
          // A reckon-mode rewind group is what asks clients to stamp.
          this.state.enemies.set("a", new Enemy());
          this.rewind.attachAll(this.state.enemies, { fields: ["x"], mode: "reckon" });
          this.setSimulationInterval(() => {
            this.state.tick++;
            for (const c of this.clients) {
              const ch = this.inputs.get(c.sessionId);
              let consumed = 0;
              for (const _i of ch.drain()) { consumed++; }
              // The RAW stamp of the last consumed input — 0 when the client
              // never sent one. (The public accessor resolves 0 to the room
              // clock, which would hide exactly what this test is checking.)
              if (consumed > 0) {
                stampedReckon = (c as any)._inputBuffer?.reckonTime;
              }
            }
          }, 25);
        }
      });

      const conn = await client.joinOrCreate("unrel_lagcomp");
      const handle = conn.input<SeqInput>({ type: SeqInput as any, mode: "unreliable", historySize: 3 });

      assert.strictEqual((handle as any)._stampReckon || (handle as any)._stampRender, true,
        "the room did advertise a lag-comp stamp");

      // A packet built WITHOUT the TIMED bit (an older client, or one whose
      // clock hasn't synced): the server must still accept it and simply read
      // that input live, rather than mis-parsing the ring as a stamp block.
      const tick = unreliableRing(SeqInput, 3);
      conn.connection.send(tick((i) => { i.seq = 1; }));
      await timeout(120);

      assert.ok(!stampedReckon, "an unstamped input reads live (reckon 0)");

      await conn.leave();
      await timeout(50);
    });
  });
});

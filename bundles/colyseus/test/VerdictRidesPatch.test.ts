import assert from "assert";
import { Client as SDKClient, Predict } from "@colyseus/sdk";
import { matchMaker, Room, Server, type Client, type MessageContext } from "@colyseus/core";
import { schema, t, type SchemaType } from "@colyseus/schema";
import { WebSocketTransport } from "@colyseus/ws-transport";

// Wire constants (brief 21, Design B) — kept local so the test pins the bytes.
const PROTOCOL_CODE_MASK = 0x1F;
const MODIFIER_FRAMES = 0x20;
const ROOM_DATA = 13;
const ROOM_STATE_PATCH = 15;
const ROOM_RESPONSE = 22;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitUntil(cond: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!cond()) {
    if (Date.now() > deadline) { throw new Error("waitUntil timed out"); }
    await sleep(10);
  }
}

const TEST_PORT = 8572;
const TEST_ENDPOINT = `ws://localhost:${TEST_PORT}`;

const VRPInput = schema({ seq: t.number(), dx: t.number() }, "VRP_Input");
type VRPInput = SchemaType<typeof VRPInput>;
const VRPBullet = schema({ x: t.number() }, "VRP_Bullet");
type VRPBullet = SchemaType<typeof VRPBullet>;
const VRPState = schema({ bullets: t.map(VRPBullet), tick: t.number() }, "VRP_State");
type VRPState = SchemaType<typeof VRPState>;

/** Tap the raw leading byte of every frame the SDK receives, after the
 *  connection is established (JOIN + initial state already consumed). */
function captureFrameBytes(conn: any): number[] {
  const bytes: number[] = [];
  const events = conn.connection.events;
  const original = events.onmessage;
  events.onmessage = (event: MessageEvent) => {
    bytes.push(new Uint8Array(event.data)[0]);
    original(event);
  };
  return bytes;
}

/**
 * Brief 21, Design B — the in-frame `predict.action` verdict rides INSIDE the
 * client's state-patch frame (the {@link MODIFIER_FRAMES} bit + a trailing,
 * length-delimited frames section), instead of a standalone `ROOM_RESPONSE`
 * frame. Proves the coalescing on the wire: a FRAMES-flagged patch arrives and
 * NO separate `ROOM_RESPONSE` does, while correlation/rollback still work.
 */
describe("In-frame verdict rides the patch (brief 21, Design B)", () => {
  let server: Server;
  const client = new SDKClient(TEST_ENDPOINT);

  class VRPRoom extends Room<{ state: VRPState; input: VRPInput }> {
    state = new VRPState();
    inputs = this.defineInput(VRPInput);
    #seq = 0;

    messages = {
      fire: (_client: Client, p: { x: number }, ctx: MessageContext) => {
        const b = new VRPBullet();
        b.x = p.x;
        this.state.bullets.set(String(this.#seq++), b);   // refId acquired synchronously
        return ctx.resolve(b);                            // OK { ref } verdict rides the patch
      },
      blocked: (_client: Client, _p: unknown, ctx: MessageContext) => ctx.reject("nope" as const),
      // trigger a room-wide afterNextPatch broadcast (TIMED room → should coalesce)
      bcastReq: (_client: Client) => this.broadcast("bcast", { v: 7 }, { afterNextPatch: true }),
    } satisfies Record<string, any>;

    onCreate() {
      this.setFixedTimestep((ctx) => {
        this.state.tick = ctx.tick;
        for (const c of this.clients) {
          for (const _inp of this.inputs.get(c.sessionId)) { /* consume */ }
        }
      }, 30);
    }
  }

  before(async () => {
    server = new Server({ greet: false, gracefullyShutdown: false, transport: new WebSocketTransport() });
    await matchMaker.setup(undefined, undefined);
    server.define("vrp", VRPRoom);
    await server.listen(TEST_PORT);
  });

  after(async () => {
    await server.gracefullyShutdown(false);
  });

  it("the OK{ref} verdict is coalesced into a FRAMES patch — no standalone ROOM_RESPONSE", async () => {
    const conn = await client.create<VRPRoom>("vrp");
    const frameBytes = captureFrameBytes(conn);

    const predict = Predict.get(conn);
    const input = conn.input({ type: VRPInput });
    const bullets = predict.spawns("bullets", { correlate: "refId", owned: () => true });
    const fire = predict.action(conn, "fire", {
      predict: (p) => bullets.spawn({ x: p.x }),
      input,
    });

    fire({ x: 5 });
    input.data.seq = 1; input.data.dx = 1;
    input.send();

    await waitUntil(() => [...bullets.entries()].some((e) => e.state === "confirmed"));

    const framedPatches = frameBytes.filter((b) =>
      (b & PROTOCOL_CODE_MASK) === ROOM_STATE_PATCH && (b & MODIFIER_FRAMES) !== 0);
    const standaloneResponses = frameBytes.filter((b) => (b & PROTOCOL_CODE_MASK) === ROOM_RESPONSE);

    assert.ok(framedPatches.length >= 1, "verdict must ride a FRAMES-flagged ROOM_STATE_PATCH");
    assert.strictEqual(standaloneResponses.length, 0,
      "the verdict was coalesced into the patch — no standalone ROOM_RESPONSE frame");
    await conn.leave();
  });

  it("a REJECTED verdict also rides the patch and still rolls back the prediction", async () => {
    const conn = await client.create<VRPRoom>("vrp");
    const frameBytes = captureFrameBytes(conn);

    const predict = Predict.get(conn);
    const input = conn.input({ type: VRPInput });
    const bullets = predict.spawns("bullets", { correlate: "refId", owned: () => true });
    const fireBad = predict.action(conn, "blocked", {
      predict: () => bullets.spawn({ x: 9 }),
      input,
    });

    fireBad({});
    assert.strictEqual([...bullets.entries()].length, 1);  // optimistic local rendered now

    input.data.seq = 1; input.data.dx = 0;
    input.send();

    await waitUntil(() => [...bullets.entries()].length === 0);  // REJECTED → rollback

    const standaloneResponses = frameBytes.filter((b) => (b & PROTOCOL_CODE_MASK) === ROOM_RESPONSE);
    assert.strictEqual(standaloneResponses.length, 0,
      "the REJECTED verdict rode the patch — no standalone ROOM_RESPONSE frame");
    await conn.leave();
  });

  it("a TIMED-room broadcast(afterNextPatch) coalesces into the patch — no standalone ROOM_DATA", async () => {
    const conn = await client.create<VRPRoom>("vrp");
    const frameBytes = captureFrameBytes(conn);

    let got: any;
    conn.onMessage("bcast", (m) => { got = m; });
    conn.send("bcastReq");                                  // server broadcasts afterNextPatch

    await waitUntil(() => got !== undefined);
    assert.deepStrictEqual(got, { v: 7 });                 // delivered

    const framedPatches = frameBytes.filter((b) =>
      (b & PROTOCOL_CODE_MASK) === ROOM_STATE_PATCH && (b & MODIFIER_FRAMES) !== 0);
    const standaloneData = frameBytes.filter((b) => (b & PROTOCOL_CODE_MASK) === ROOM_DATA);
    assert.ok(framedPatches.length >= 1, "broadcast must ride a FRAMES patch");
    assert.strictEqual(standaloneData.length, 0,
      "in a TIMED room the broadcast coalesced into the patch — no standalone ROOM_DATA frame");
    await conn.leave();
  });
});

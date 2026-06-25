import assert from "assert";
import { Client as SDKClient, Predict } from "@colyseus/sdk";
import { matchMaker, Room, Server, type Client, type MessageContext } from "@colyseus/core";
import { schema, t, type SchemaType } from "@colyseus/schema";
import { WebSocketTransport } from "@colyseus/ws-transport";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitUntil(cond: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!cond()) {
    if (Date.now() > deadline) { throw new Error("waitUntil timed out"); }
    await sleep(10);
  }
}

const TEST_PORT = 8569;
const TEST_ENDPOINT = `ws://localhost:${TEST_PORT}`;

const $REF_ID = Symbol.for("$refId");
const refIdOf = (entity: any): number | undefined => entity?.[$REF_ID];

const Bullet = schema({ x: t.number(), y: t.number() }, "PA_Bullet");
type Bullet = SchemaType<typeof Bullet>;
const PAState = schema({ bullets: t.map(Bullet) }, "PA_State");
type PAState = SchemaType<typeof PAState>;

/**
 * Integration coverage for brief 18 — the standalone discrete-action verdict
 * over the real request/response wire: `ResponseStatus.REJECTED`, `ctx.reject` /
 * `ctx.resolve(entity)` → private `{ ref }` echo, ERROR vs REJECTED, graceful
 * degradation, and the SDK's `request` surfacing of the typed reason.
 */
describe("Predicted Actions (standalone verdict wire)", () => {
  let server: Server;
  const client = new SDKClient(TEST_ENDPOINT);
  let lastBulletRefId: number | undefined;

  class ActionsRoom extends Room<{ state: PAState }> {
    state = new PAState();
    #seq = 0;
    // declarative `messages` field (ctx is the 3rd param) — the SDK reads this to
    // type `predict.action(conn, "fire", …)` payloads/reasons.
    messages = {
      fire: (_client: Client, payload: { x: number; y: number }, ctx: MessageContext) => {
        const b = new Bullet();
        b.x = payload.x;
        b.y = payload.y;
        this.state.bullets.set(String(this.#seq++), b);  // refId acquired synchronously
        lastBulletRefId = refIdOf(b);
        return ctx.resolve(b);                            // accept + private { ref } echo
      },
      cooldown: (_client: Client, _payload: unknown, ctx: MessageContext) => ctx.reject("cooldown" as const),
      boom: () => { throw new Error("kaboom"); },
      clean: () => { /* old-style handler: clean return → accept, no ref */ },
      confirmNoEntity: (_client: Client, _payload: unknown, ctx: MessageContext) => ctx.resolve(), // accept, no ref
    };
  }

  /** Collect a single action reply via the low-level sendRequest primitive,
   *  reshaped into the `{ ok, ref, reason, thrown }` the assertions read. */
  function verdictOf(conn: any, type: string, payload?: any): Promise<any> {
    return new Promise((resolve) => {
      conn.sendRequest(type, payload, {}, (ok: boolean, p: any, faulted: boolean) => {
        resolve(ok ? { ok: true, ref: p?.ref } : { ok: false, reason: p, thrown: faulted });
      });
    });
  }

  before(async () => {
    server = new Server({
      greet: false,
      gracefullyShutdown: false,
      transport: new WebSocketTransport(),
    });
    await matchMaker.setup(undefined, undefined);
    server.define("actions", ActionsRoom);
    await server.listen(TEST_PORT);
  });

  after(async () => {
    await server.gracefullyShutdown(false);
  });

  it("ctx.resolve(entity) → OK with the private { ref } echo (= the entity's refId)", async () => {
    const conn = await client.joinOrCreate("actions");
    const verdict = await verdictOf(conn, "fire", { x: 1, y: 2 });
    assert.strictEqual(verdict.ok, true);
    assert.strictEqual(typeof verdict.ref, "number");
    assert.strictEqual(verdict.ref, lastBulletRefId);   // exact refId echoed, not broadcast
    await conn.leave();
  });

  it("ctx.reject(reason) → REJECTED carrying the raw typed reason", async () => {
    const conn = await client.joinOrCreate("actions");
    const verdict = await verdictOf(conn, "cooldown");
    assert.strictEqual(verdict.ok, false);
    assert.strictEqual(verdict.thrown, false);          // deliberate reject, not a thrown error
    assert.strictEqual(verdict.reason, "cooldown");
    await conn.leave();
  });

  it("a thrown handler → ERROR (distinct from REJECTED)", async () => {
    const conn = await client.joinOrCreate("actions");
    const verdict = await verdictOf(conn, "boom");
    assert.strictEqual(verdict.ok, false);
    assert.strictEqual(verdict.thrown, true);           // ERROR arm
    assert.strictEqual(verdict.reason?.message, "kaboom");
    await conn.leave();
  });

  it("graceful degradation: a clean-return (old-style) handler → accept, no ref", async () => {
    const conn = await client.joinOrCreate("actions");
    const verdict = await verdictOf(conn, "clean");
    assert.strictEqual(verdict.ok, true);
    assert.strictEqual(verdict.ref, undefined);         // no ctx.resolve(entity) → no echo
    await conn.leave();
  });

  it("ctx.resolve() with no entity → accept, no ref", async () => {
    const conn = await client.joinOrCreate("actions");
    const verdict = await verdictOf(conn, "confirmNoEntity");
    assert.strictEqual(verdict.ok, true);
    assert.strictEqual(verdict.ref, undefined);
    await conn.leave();
  });

  it("room.request() resolves on accept and rejects with .reason on REJECTED", async () => {
    const conn = await client.joinOrCreate("actions");
    await conn.request("fire", { x: 0, y: 0 });          // resolves (accept)

    await assert.rejects(conn.request("cooldown"), (err: any) => {
      assert.strictEqual(err.reason, "cooldown");
      assert.strictEqual(err.name, "rejected");
      return true;
    });
    await conn.leave();
  });

  it("request() surfaces a REJECTED reason as error.reason (unwrapped, not Error-shaped)", async () => {
    const conn = await client.joinOrCreate("actions");
    await assert.rejects(conn.request("cooldown"), (err: any) => {
      assert.strictEqual(err.reason, "cooldown");
      return true;
    });
    await conn.leave();
  });

  it("predict.action + ctx.resolve(bullet): the predicted bullet correlates to its authoritative copy by the echoed refId (no duplicate)", async () => {
    const conn = await client.create<ActionsRoom>("actions"); // fresh room — isolated bullets collection
    const predict = Predict.get(conn);
    const bullets = predict.spawns("bullets", { correlate: "refId", owned: () => true });
    const fire = predict.action(conn, "fire", {
      predict: (p) => bullets.spawn({ x: p.x, y: p.y }),  // p inferred from messages.fire
    });

    fire({ x: 3, y: 4 });
    // predicts NOW: exactly one pending local, no server copy yet
    let entries = [...bullets.entries()];
    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0].state, "pending");
    assert.strictEqual(entries[0].local?.x, 3);

    // verdict ({ ref }) + the authoritative ADD land → handoff onto ONE logical entry
    await waitUntil(() => [...bullets.entries()].some((e) => e.state === "confirmed"));
    entries = [...bullets.entries()];
    assert.strictEqual(entries.length, 1);          // no duplicate for the server copy
    assert.strictEqual(entries[0].state, "confirmed");
    assert.ok(entries[0].server);                   // authoritative copy present
    assert.strictEqual(entries[0].local?.x, 3);     // predicted local retained across handoff
    await conn.leave();
  });

  it("predict.action: a server-rejected shot vanishes on the REJECTED response (not on TTL)", async () => {
    const conn = await client.create<ActionsRoom>("actions");
    const predict = Predict.get(conn);
    const bullets = predict.spawns("bullets", { correlate: "refId", owned: () => true });
    // "cooldown" always rejects and never spawns server-side
    const fireBad = predict.action(conn, "cooldown", {
      predict: () => bullets.spawn({ x: 9, y: 9 }),
    });

    fireBad({});
    assert.strictEqual([...bullets.entries()].length, 1); // optimistic local rendered now

    // REJECTED arrives → immediate rollback (well within any 2×RTT TTL window)
    await waitUntil(() => [...bullets.entries()].length === 0);
    assert.strictEqual([...bullets.entries()].length, 0);
    await conn.leave();
  });
});

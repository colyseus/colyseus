import assert from "assert";
import { matchMaker, Room, type MatchMakerDriver, type Client } from "@colyseus/core";
import { schema, t, type SchemaType } from "@colyseus/schema";
import { createDummyClient, timeout, DRIVERS } from "../utils/index.ts";

const PaddleInput = schema({ dx: t.number().default(0) });
type PaddleInput = SchemaType<typeof PaddleInput>;

const RECONNECT_SECONDS = 0.2; // 200ms reconnection window

// idle policy declared → bare next() is total; the fix extends that to ABSENT
// (dropped, reconnecting) seats whose accessor outlives `this.clients`.
class IdleAbsentRoom extends Room {
  maxClients = 4;
  inputs = this.defineInput(PaddleInput, { idle: true });
  onCreate() {}
  onDrop(client: Client) { this.allowReconnection(client, RECONNECT_SECONDS); }
}

// bufferMaxSize:0 → no per-client buffer, so NO idle for live OR absent seats.
class IdleAbsentLatestOnlyRoom extends Room {
  maxClients = 4;
  inputs = this.defineInput(PaddleInput, { idle: true, bufferMaxSize: 0 });
  onCreate() {}
  onDrop(client: Client) { this.allowReconnection(client, RECONNECT_SECONDS); }
}

describe("Input: idle for absent (disconnected) sessions", () => {
  let driver: MatchMakerDriver;

  before(async () => {
    driver = new DRIVERS[0]();
    matchMaker.setup(undefined, driver);
    if (driver.boot) { await driver.boot(); }
    matchMaker.defineRoomType("idle_absent", IdleAbsentRoom);
    matchMaker.defineRoomType("idle_absent_latest", IdleAbsentLatestOnlyRoom);
    await timeout(50);
  });

  after(async () => {
    await driver.clear();
    await driver.shutdown();
  });

  beforeEach(async () => {
    await driver.clear();
    await matchMaker.setup(undefined, driver);
    await matchMaker.accept();
  });

  // Join two clients (the second keeps the room alive through the window) and
  // return the room + the first client (the one we drop).
  async function joinPair(type: string) {
    const seat1 = await matchMaker.joinOrCreate(type);
    const seat2 = await matchMaker.joinOrCreate(type);
    const room = matchMaker.getLocalRoomById(seat1.roomId) as IdleAbsentRoom;
    const client1 = createDummyClient(seat1);
    const client2 = createDummyClient(seat2);
    await client1.confirmJoinRoom(room);
    await client2.confirmJoinRoom(room);
    return { room, seat1, client1, client2 };
  }

  it("synthesizes idle for a dropped seat during the reconnection window (the fix)", async () => {
    const { room, client1, client2 } = await joinPair("idle_absent");
    const sid = client1.sessionId;

    // connected: idle already fires on an empty tick (existing behavior)
    assert.ok(room.inputs.get(sid).next(), "connected empty tick → idle frame");
    const heldAccessor = room.inputs.get(sid);

    client1.close();           // abnormal close → onDrop → allowReconnection
    await timeout(50);

    assert.equal(room.clients.get(sid), undefined, "dropped client left this.clients");
    const cmd = room.inputs.get(sid).next();
    assert.ok(cmd, "ABSENT seat STILL synthesizes idle");
    assert.equal(cmd!.dx, 0, "idle defaults — entity holds still");
    assert.equal(room.inputs.get(sid), heldAccessor, "same retained accessor across the drop");

    client2.close();
    await timeout(RECONNECT_SECONDS * 1000 + 150);
  });

  it("drops the accessor on full leave → inputs.get() falls back to NO_OP (undefined)", async () => {
    const { room, client1, client2 } = await joinPair("idle_absent");
    const sid = client1.sessionId;

    client1.close();
    await timeout(50);
    assert.ok(room.inputs.get(sid).next(), "idle during the window");

    // let the window expire without reconnecting → session fully gone
    await timeout(RECONNECT_SECONDS * 1000 + 150);
    assert.equal(room.clients.get(sid), undefined);
    assert.equal(room.inputs.get(sid).next(), undefined, "no entry → NO_OP → skip");

    client2.close();
    await timeout(RECONNECT_SECONDS * 1000 + 150);
  });

  it("reconnect overwrites the registry with the new client's fresh accessor", async () => {
    const { room, seat1, client1, client2 } = await joinPair("idle_absent");
    const sid = client1.sessionId;
    const before = room.inputs.get(sid);

    client1.close();
    await timeout(50);
    assert.ok(room.inputs.get(sid).next(), "idle during the window");

    await matchMaker.reconnect(room.roomId, { reconnectionToken: client1.reconnectionToken });
    await createDummyClient(seat1).confirmJoinRoom(room, client1.reconnectionToken);

    const after = room.inputs.get(sid);
    assert.notEqual(after, before, "reconnect installed a fresh accessor (no stale shadow)");
    assert.equal(room.clients.get(sid)?.sessionId, sid, "reconnected client back in this.clients");

    client2.close();
    await timeout(RECONNECT_SECONDS * 1000 + 150);
  });

  it("bufferMaxSize:0 room: absent seat stays undefined (no idle, matching live)", async () => {
    const seat1 = await matchMaker.joinOrCreate("idle_absent_latest");
    const seat2 = await matchMaker.joinOrCreate("idle_absent_latest");
    const room = matchMaker.getLocalRoomById(seat1.roomId) as IdleAbsentLatestOnlyRoom;
    const client1 = createDummyClient(seat1);
    const client2 = createDummyClient(seat2);
    await client1.confirmJoinRoom(room);
    await client2.confirmJoinRoom(room);
    const sid = client1.sessionId;

    assert.equal(room.inputs.get(sid).next(), undefined, "no buffer → no idle while live");

    client1.close();
    await timeout(50);
    assert.equal(room.inputs.get(sid).next(), undefined, "absent: still undefined (consistent)");

    client2.close();
    await timeout(RECONNECT_SECONDS * 1000 + 150);
  });
});

import assert from "assert";
import sinon from "sinon";
import { matchMaker } from "@colyseus/core";

import { before } from "mocha";
import { boot, ColyseusTestServer } from "../src";

import appConfig from "./app1/app.config";
import { State } from "./app1/RoomWithState";
import { SimulationState } from "./app1/RoomWithSimulation";
import { JWT } from "../../auth";

describe("@colyseus/testing", () => {
  JWT.settings.secret = "secret";

  let colyseus: ColyseusTestServer;

  before(async () => colyseus = await boot(appConfig));
  after(async () => colyseus.shutdown());

  beforeEach(async () => {
    await colyseus.cleanup();
    assert.strictEqual(0, (await matchMaker.query({})).length);
  });

  it("should be able to test http routes", async () => {
    const response = await colyseus.http.get("/something");
    assert.deepStrictEqual({ success: true }, response.data);
    assert.strictEqual('1', response.headers['header-one']);
  });

  it("basic usage", async () => {
    const client = await colyseus.sdk.joinOrCreate("room_with_state", {});
    const room = colyseus.getRoomById(client.id);

    assert.strictEqual(client.id, room.roomId);
  });

  it("colyseus.createRoom() + connectTo()", async () => {
    const room = await colyseus.createRoom<State>("room_with_state", {});

    const onJoinSpy = sinon.spy(room, 'onJoin');
    const onLeaveSpy = sinon.spy(room, 'onLeave');

    const client = await colyseus.connectTo(room);
    sinon.assert.callCount(onJoinSpy, 1);
    sinon.assert.callCount(onLeaveSpy, 0);

    // wait for next state
    await room.waitForNextPatch();
    assert.deepStrictEqual({
      players: {
        [client.sessionId]: {
          playerNum: 1,
          score: 0
        }
      }
    }, client.state.toJSON());

    await client.leave();
    sinon.assert.callCount(onLeaveSpy, 1);
  });

  it("room.waitForNextMessage()", async () => {
    const client = await colyseus.sdk.joinOrCreate("room_without_state");
    const room = colyseus.getRoomById(client.id);

    let received: boolean = false;
    // client.onMessage("one-pong", (message) => {
    //   assert.deepStrictEqual(message, ["one", "data"]);
    //   received = true;
    // });

    room.onMessage("one-ping", (client, message)=>{
      received = true;
    })

    client.send("one-ping", "data");
    await room.waitForNextMessage();

    assert.ok(received);
  });

  it("room.waitForNextPatch()", async () => {
    const client1 = await colyseus.sdk.joinOrCreate<State>("room_with_state");
    const client2 = await colyseus.sdk.joinOrCreate<State>("room_with_state");

    const room = colyseus.getRoomById<State>(client1.id);
    assert.strictEqual(0, room.state.players.get(client1.sessionId).score);

    client1.send("mutate");
    await room.waitForNextPatch();

    assert.strictEqual(1, room.state.players.get(client1.sessionId).score);
  });

  it("waitForNextSimulationTick()", async () => {
    const room = await colyseus.createRoom<SimulationState>("room_with_simulation");
    const client = await colyseus.connectTo(room);

    let currentTick = room.state.tick;
    for (let i = 0; i < 5; i++) {
      await room.waitForNextSimulationTick();

      assert.strictEqual(++currentTick, room.state.tick);
    }

    await room.waitForNextPatch();
    assert.strictEqual(room.state.tick, client.state.tick);
  });

  it("should disconnect all connected clients after test is done", async () => {
    const existingRooms = await matchMaker.query({ name: "room_with_state" });
    assert.strictEqual(0, existingRooms.length);

    const clients: any = [];
    for (let i = 0; i < 10; i++) {
      clients.push(await colyseus.sdk.joinOrCreate("room_with_state"));
    }
  });

  it("should wait for a particular message to arrive in the server", async () => {
    const client1 = await colyseus.sdk.joinOrCreate("room_without_state");
    const room = colyseus.getRoomById(client1.id);

    client1.send("one-ping", "data");

    const [ client, message ] = await room.waitForMessage("one-ping");
    assert.strictEqual(client.sessionId, client1.sessionId);
    assert.strictEqual("data", message);
  });

  describe('auth-module', () => {
    it('signs in with email and password', async () => {
      const { user } = await colyseus.sdk.auth.signInWithEmailAndPassword("user@email.com", "password");
      assert.deepStrictEqual(user, { name: "name" });
    });

    it('gets user data', async () => {
      await colyseus.sdk.auth.signInWithEmailAndPassword("user@email.com", "password");

      const { user } = await colyseus.sdk.auth.getUserData();

      assert.strictEqual(user.name, "name");
    });

    it('signs in anonymously', async () => {
      const { user } = await colyseus.sdk.auth.signInAnonymously();
      assert.strictEqual(user.anonymous, true);
    });
  })

  describe("client-side", () => {

    it("should wait for a particular message to arrive in the client-side", async () => {
      const client1 = await colyseus.sdk.joinOrCreate("room_without_state");
      client1.send("one-ping", "data");

      const payload = await client1.waitForMessage("one-pong");
      assert.deepStrictEqual(['one', 'data'], payload);

      // waiting for a message that never arrives.
      await assert.rejects(async () => await client1.waitForMessage("never-called", 100));
    });

    it("should wait for a particular message to arrive in the client-side", async () => {
      const client1 = await colyseus.sdk.joinOrCreate("room_without_state");
      client1.send("one-ping", "data");

      const [type, payload] = await client1.waitForNextMessage();
      assert.deepStrictEqual('one-pong', type);
      assert.deepStrictEqual(['one', 'data'], payload);
    });
  });
});

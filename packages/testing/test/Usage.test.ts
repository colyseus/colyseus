import assert from "assert";
import sinon from "sinon";
import { matchMaker } from "@colyseus/core";

import { before } from "mocha";
import { boot, ColyseusTestServer } from "../src/index.ts";

import appConfig from "./app1/app.config.ts";
import { State, RoomWithState } from "./app1/RoomWithState.ts";
import { JWT } from "@colyseus/auth";
import { MapSchema } from "@colyseus/schema";
import { RoomWithoutState } from "./app1/RoomWithoutState.ts";

describe("@colyseus/testing", () => {
  JWT.settings.secret = "secret";

  let colyseus: ColyseusTestServer<typeof appConfig>;

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
    const sdkRoom = await colyseus.sdk.joinOrCreate("room_with_state", {});
    const room = colyseus.getRoomById(sdkRoom.roomId);

    assert.strictEqual(sdkRoom.roomId, room.roomId);
  });

  it("colyseus.createRoom() + connectTo()", async () => {
    const room = await colyseus.createRoom("room_with_state", {});

    const onJoinSpy = sinon.spy(room, 'onJoin');
    const onLeaveSpy = sinon.spy(room, 'onLeave');

    const sdkRoom = await colyseus.connectTo(room);
    sinon.assert.callCount(onJoinSpy, 1);
    sinon.assert.callCount(onLeaveSpy, 0);

    sdkRoom.send("chat", "hey");

    sdkRoom.onMessage("chat", ([sessionId, message]) =>
      console.log(sessionId, message));

    // wait for next state
    await room.waitForNextPatch();
    assert.deepStrictEqual({
      players: {
        [sdkRoom.sessionId]: {
          playerNum: 1,
          score: 0
        }
      }
    }, sdkRoom.state.toJSON());

    await sdkRoom.leave();
    sinon.assert.callCount(onLeaveSpy, 1);
  });

  it("room.waitForNextMessage()", async () => {
    const sdkRoom = await colyseus.sdk.joinOrCreate("room_without_state");
    const room = colyseus.getRoomById<RoomWithoutState>(sdkRoom.roomId);

    assert.ok(room instanceof RoomWithoutState);

    let received: boolean = false;

    // client.onMessage("one-pong", (message) => {
    //   assert.deepStrictEqual(message, ["one", "data"]);
    //   received = true;
    // });

    room.onMessage("one-ping", (client, message)=>{
      received = true;
    })

    sdkRoom.send("one-ping", "data");
    await room.waitForNextMessage();

    assert.ok(received);
  });

  it("room.waitForNextPatch()", async () => {
    const client1 = await colyseus.sdk.joinOrCreate("room_with_state");
    const client2 = await colyseus.sdk.joinOrCreate("room_with_state");

    const room = colyseus.getRoomById<State>(client1.roomId);
    assert.strictEqual(0, room.state.players.get(client1.sessionId).score);

    client1.send("mutate");
    await room.waitForNextPatch();

    assert.strictEqual(1, room.state.players.get(client1.sessionId).score);
  });

  it("waitForNextSimulationTick()", async () => {
    const room = await colyseus.createRoom("room_with_simulation");
    const sdkRoom = await colyseus.connectTo(room);

    let currentTick = room.state.tick;
    for (let i = 0; i < 5; i++) {
      await room.waitForNextSimulationTick();

      assert.strictEqual(++currentTick, room.state.tick);
    }

    await room.waitForNextPatch();
    assert.strictEqual(room.state.tick, sdkRoom.state.tick);
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
    const room = colyseus.getRoomById(client1.roomId);

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

  describe("method overloads", () => {

    describe("createRoom()", () => {
      it("inferred generic", async () => {
        // Type is automatically inferred from room name
        const room = await colyseus.createRoom("room_with_state", {});

        assert.ok(room.roomId);
        assert.ok(room.state);
        assert.ok(room.state.players instanceof MapSchema);
        assert.strictEqual(typeof room.state.players.size, "number");

        await room.disconnect();
      });

      it("explicit 'typeof Room'", async () => {
        const room = await colyseus.createRoom<RoomWithState>("room_with_state", {});

        assert.ok(room.roomId);
        assert.ok(room.state);
        assert.ok(room.state.players instanceof MapSchema);

        await room.disconnect();
      });

      it("explicit 'State' generic", async () => {
        const room = await colyseus.createRoom<State>("room_with_state", {});

        assert.ok(room.roomId);
        assert.ok(room.state);
        assert.ok(room.state.players instanceof MapSchema);

        await room.disconnect();
      });
    });

    describe("getRoomById()", () => {
      it("inferred generic (any)", async () => {
        const sdkRoom = await colyseus.sdk.joinOrCreate("room_with_state", {});

        // No type parameter - defaults to any
        const room = colyseus.getRoomById(sdkRoom.roomId);

        assert.strictEqual(room.roomId, sdkRoom.roomId);

        await sdkRoom.leave();
      });

      it("explicit 'typeof Room'", async () => {
        const sdkRoom = await colyseus.sdk.joinOrCreate("room_with_state", {});

        const room = colyseus.getRoomById<RoomWithState>(sdkRoom.roomId);

        assert.strictEqual(room.roomId, sdkRoom.roomId);
        assert.ok(room.state);
        assert.ok(room.state.players instanceof MapSchema);

        await sdkRoom.leave();
      });

      it("explicit 'State' generic", async () => {
        const sdkRoom = await colyseus.sdk.joinOrCreate("room_with_state", {});

        const room = colyseus.getRoomById<State>(sdkRoom.roomId);

        assert.strictEqual(room.roomId, sdkRoom.roomId);
        assert.ok(room.state);
        assert.ok(room.state.players instanceof MapSchema);

        await sdkRoom.leave();
      });
    });

  });
});

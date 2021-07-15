import assert from "assert";
import sinon from "sinon";

import { before } from "mocha";
import { boot, ColyseusTestServer } from "../src";

import appConfig from "./app1/arena.config";

describe("@colyseus/testing", () => {
  let colyseus: ColyseusTestServer;

  before(async () => colyseus = await boot(appConfig));
  after(async () => colyseus.shutdown());

  beforeEach(async () => await colyseus.cleanup());
  afterEach(() => {});

  it("should connect a client into the room", async () => {
    const connection = await colyseus.clientSDK.joinOrCreate("room_with_state", {});
    const room = colyseus.getRoomById(connection.id);

    assert.strictEqual(connection.id, room.roomId);
  });

  it("should join a room by id - assert callCount", async () => {
    const room = await colyseus.createRoom("room_with_state", {});

    const onJoinSpy = sinon.spy(room, 'onJoin');
    const onLeaveSpy = sinon.spy(room, 'onLeave');

    const connection = await colyseus.clientSDK.joinById(room.roomId);
    sinon.assert.callCount(onJoinSpy, 1);
    sinon.assert.callCount(onLeaveSpy, 0);

    await connection.leave();
    sinon.assert.callCount(onLeaveSpy, 1);
  });

  it("should assert for messages", async () => {
    const client = await colyseus.clientSDK.joinOrCreate("room_without_state");
    const room = colyseus.getRoomById(client.id);

    let received: boolean = false;
    client.onMessage("one-pong", (message) => {
      console.log(">>> received pong!");
      assert.deepStrictEqual(message, ["one", "data"]);
      received = true;
    });

    client.send("one-ping", "data");
    await room.waitForMessage();

    assert.ok(received);
  });

});
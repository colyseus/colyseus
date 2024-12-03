import assert from "assert";

import * as Colyseus from "colyseus.js";
import { Room, Server, matchMaker } from "@colyseus/core";
import WebSocket from "ws";

const TEST_PORT = 8570;
const TEST_ENDPOINT = `ws://localhost:${TEST_PORT}`;

describe("Graceful Shutdown", () => {
  let server: Server;
  let client = new Colyseus.Client(TEST_ENDPOINT);

  beforeEach(async () => {
    server = new Server({ greet: false, gracefullyShutdown: false });

    // setup matchmaker
    matchMaker.setup(undefined, undefined)

    // listen for testing
    await server.listen(TEST_PORT);
  });

  afterEach(async () => {
    await matchMaker.disconnectAll();
    await server.gracefullyShutdown(false);
  });

  it("should wait all onLeave before onShutdown", async () => {
    let onLeaveTime = [];
    let onDisposeTime: number = undefined;
    let onShutdownTime: number = undefined;

    server.onShutdown(() => {
      onShutdownTime = Date.now();
    });

    server.define("my_room", class extends Room {
      async onLeave () {
        // simulate long database operation
        await new Promise((resolve) => setTimeout(resolve, 100 + Math.random() * 400));
        onLeaveTime.push(Date.now());
      }
      async onDispose() {
        // simulate long database operation
        await new Promise((resolve) => setTimeout(resolve, 100));
        onDisposeTime = Date.now();
      }
    });

    await Promise.all([
      client.joinOrCreate("my_room"),
      client.joinOrCreate("my_room"),
      client.joinOrCreate("my_room"),
    ]);

    await server.gracefullyShutdown(false);

    assert.strictEqual(onLeaveTime.length, 3);
    assert.ok(onLeaveTime[0] < onDisposeTime);
    assert.ok(onLeaveTime[1] < onDisposeTime);
    assert.ok(onLeaveTime[2] < onDisposeTime);
    assert.ok(onDisposeTime <= onShutdownTime);
  });

  it("early disconnect should trigger onLeave before onShutdown", async () => {
    let onLeaveTime = [];
    let onDisposeTime: number = undefined;
    let onShutdownTime: number = undefined;

    server.define("my_room", class extends Room {
      onCreate() {}
      async onJoin (client) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      async onLeave (client) {
        // simulate long database operation
        await new Promise((resolve) => setTimeout(resolve, 100 + Math.random() * 400));
        onLeaveTime.push(Date.now());
      }
      async onDispose() {
        // simulate long database operation
        await new Promise((resolve) => setTimeout(resolve, 100));
        onDisposeTime = Date.now();
      }
    });

    // regular connections
    const [_1, _2, seatReservation] = await Promise.all([
      client.joinOrCreate("my_room"),
      client.joinOrCreate("my_room"),
      matchMaker.joinOrCreate('my_room', {})
    ]);

    // simulate early disconnect
    const lostConnection = new WebSocket(`${TEST_ENDPOINT}/${seatReservation.room.processId}/${seatReservation.room.roomId}?sessionId=${seatReservation.sessionId}`);
    lostConnection.on("open", () => lostConnection.close());

    server.onShutdown(() => {
      onShutdownTime = Date.now();
    });

    await server.gracefullyShutdown(false);

    assert.strictEqual(onLeaveTime.length, 3);
    assert.ok(onLeaveTime[0] < onDisposeTime);
    assert.ok(onLeaveTime[1] < onDisposeTime);
    assert.ok(onLeaveTime[2] < onDisposeTime);
    assert.ok(onDisposeTime <= onShutdownTime);
  });


});

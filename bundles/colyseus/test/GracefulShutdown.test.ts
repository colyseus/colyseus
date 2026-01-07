import assert from "assert";

import * as ColyseusSDK from "@colyseus/sdk";
import { Room, Server, matchMaker } from "@colyseus/core";
import WebSocket from "ws";

const TEST_PORT = 8570;
const TEST_ENDPOINT = `ws://localhost:${TEST_PORT}`;

describe("Graceful Shutdown", () => {
  let server: Server;
  let client = new ColyseusSDK.Client(TEST_ENDPOINT);

  beforeEach(async () => {
    server = new Server({ greet: false, gracefullyShutdown: false });

    // setup matchmaker
    await matchMaker.setup();

    // listen for testing
    await server.listen(TEST_PORT);
  });

  afterEach(async () => {
    await server.gracefullyShutdown(false);
  });

  it("should wait all onLeave before onShutdown", async () => {
    let onLeaveTime: number[] = [];
    let onDisposeTime: number = NaN;
    let onShutdownTime: number = NaN;

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
    let onLeaveTime: number[] = [];
    let onDisposeTime: number = NaN;
    let onShutdownTime: number = NaN;

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
    const lostConnection = new WebSocket(`${TEST_ENDPOINT}/${seatReservation.processId}/${seatReservation.roomId}?sessionId=${seatReservation.sessionId}`);
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

  it("should not try to reconnect if client disconnects during shutdown", async () => {
    let onLeaveCalled = false;
    let onLeaveCode: number | undefined;
    let onDropCalled = false;
    let onReconnectCalled = false;

    server.define("my_room", class extends Room {
      onCreate() {}
      onJoin() {}
      onLeave() {}
    });

    const room = await client.joinOrCreate("my_room");

    room.onLeave((code) => {
      onLeaveCalled = true;
      onLeaveCode = code;
    });

    room.onDrop(() => {
      onDropCalled = true;
    });

    room.onReconnect(() => {
      onReconnectCalled = true;
    });

    await server.gracefullyShutdown(false);

    // give some time for any reconnection attempts to occur
    await new Promise((resolve) => setTimeout(resolve, 100));

    assert.strictEqual(onLeaveCalled, true, "onLeave should have been called");
    assert.strictEqual(onLeaveCode, ColyseusSDK.CloseCode.SERVER_SHUTDOWN, "onLeave code should be SERVER_SHUTDOWN (4001)");
    assert.strictEqual(onDropCalled, false, "onDrop should NOT be called during graceful shutdown");
    assert.strictEqual(onReconnectCalled, false, "onReconnect should NOT be called during graceful shutdown");
  });


});

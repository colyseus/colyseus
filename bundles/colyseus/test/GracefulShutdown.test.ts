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

  //
  // Rooms with *variable* onDispose() durations: `stats.local.roomCount` is
  // decremented when 'dispose' is emitted, which is before an async onDispose()
  // settles — so the first room to finish used to release the whole shutdown.
  // (colyseus/colyseus#823)
  //
  it("should wait for every async onDispose(), not just the fastest", async () => {
    const NUM_ROOMS = 10;

    let disposeStarted = 0;
    let disposeFinished = 0;
    let finishedAtShutdown = -1;

    server.define("my_room", class extends Room {
      maxClients = 1;
      onCreate() { }
      async onDispose() {
        disposeStarted++;
        await new Promise((resolve) => setTimeout(resolve, 50 + Math.floor(Math.random() * 500)));
        disposeFinished++;
      }
    });

    server.onShutdown(() => {
      finishedAtShutdown = disposeFinished;
    });

    await Promise.all(
      Array.from({ length: NUM_ROOMS }, () => client.joinOrCreate("my_room"))
    );

    assert.strictEqual(matchMaker.stats.local.roomCount, NUM_ROOMS);

    await server.gracefullyShutdown(false);

    assert.strictEqual(disposeStarted, NUM_ROOMS, "all rooms should have started disposing");
    assert.strictEqual(
      finishedAtShutdown,
      NUM_ROOMS,
      `onShutdown ran with only ${finishedAtShutdown}/${NUM_ROOMS} onDispose() resolved`
    );
  });

  it("should not shut down presence/driver while onDispose() is pending", async () => {
    const NUM_ROOMS = 10;
    let disposeFinished = 0;
    let finishedAtPresenceShutdown = -1;

    server.define("my_room", class extends Room {
      maxClients = 1;
      onCreate() { }
      async onDispose() {
        await new Promise((resolve) => setTimeout(resolve, 50 + Math.floor(Math.random() * 500)));
        disposeFinished++;
      }
    });

    await Promise.all(
      Array.from({ length: NUM_ROOMS }, () => client.joinOrCreate("my_room"))
    );

    const presence: any = matchMaker.presence;
    const originalShutdown = presence.shutdown;
    presence.shutdown = function () {
      finishedAtPresenceShutdown = disposeFinished;
      return originalShutdown.apply(this, arguments);
    };

    try {
      await server.gracefullyShutdown(false);
    } finally {
      presence.shutdown = originalShutdown;
    }

    assert.strictEqual(
      finishedAtPresenceShutdown,
      NUM_ROOMS,
      `presence.shutdown() ran with only ${finishedAtPresenceShutdown}/${NUM_ROOMS} onDispose() resolved`
    );
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

describe("Graceful Shutdown - presence/driver race", () => {
  it("should not crash when presence/driver are unset (matchMaker.setup().then() hasn't fired)", async () => {
    // Reproduces the race window between Server construction and the chained
    // matchMaker.setup().then() callback that assigns this.presence/this.driver.
    // Observable in production when setup is slow (e.g. Redis client connecting
    // on Colyseus Cloud). gracefullyShutdown must guard against undefined here.
    const noopTransport = {
      listen() { return this; },
      shutdown() {},
      simulateLatency() {},
    } as any;

    const server = new Server({
      greet: false,
      gracefullyShutdown: false,
      transport: noopTransport,
    });

    // Let matchMaker.setup() and the constructor's chained .then() complete,
    // then clear the assignments to simulate the pre-resolution window.
    await new Promise((resolve) => setTimeout(resolve, 50));
    (server as any).presence = undefined;
    (server as any).driver = undefined;

    await assert.doesNotReject(() => server.gracefullyShutdown(false));
  });
});

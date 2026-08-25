import assert from "assert";
import config from "@colyseus/tools";
import { defineRoom, LocalDriver } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";

import { boot, ColyseusTestServer } from "../src/index.ts";
import { RoomWithoutState } from "./app1/RoomWithoutState.ts";

// clear() resolving on a macrotask, like the database/redis/mongoose drivers.
class SlowClearDriver extends LocalDriver {
  cleared = false;

  public async clear() {
    await new Promise((resolve) => setTimeout(resolve, 20));
    super.clear();
    this.cleared = true;
  }
}

describe("cleanup() with an asynchronous driver.clear()", () => {
  const driver = new SlowClearDriver();
  let colyseus: ColyseusTestServer;

  before(async () => colyseus = await boot(config({
    rooms: { my_room: defineRoom(RoomWithoutState) },
    options: { driver },
    initializeTransport: (options) => new WebSocketTransport(options),
  }), 2569));

  after(async () => colyseus.shutdown());

  it("cleanup() resolves only after clear() completed", async () => {
    driver.cleared = false;
    await colyseus.cleanup();
    assert.strictEqual(driver.cleared, true);
  });

  it("a room created right after cleanup() survives the wipe", async () => {
    await colyseus.cleanup();
    const room = await colyseus.createRoom("my_room");

    // an un-awaited clear() would land here and delete the fresh cache row
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.ok(await driver.has(room.roomId));
  });
});

import assert from "assert";
import { RedisDriver } from "@colyseus/redis-driver";
import { initializeRoomCache } from "@colyseus/core";

describe("RedisDriver", () => {
  let driver: RedisDriver;

  before(async () => {
    driver = new RedisDriver();
    // await driver.boot(); // Register Lua scripts
  });

  after(async () => {
    await driver.shutdown();
  });

  it("should allow concurrent queries to multiple room names", async () => {
    // Clear any existing data
    driver.clear();

    for (let i=0; i<10; i++) { await driver.persist(initializeRoomCache({ name: "one", roomId: "x" + i, clients: i, maxClients: 10, })); }
    for (let i=0; i<10; i++) { await driver.persist(initializeRoomCache({ name: "two", roomId: "y" + i, clients: i, maxClients: 10, })); }
    for (let i=0; i<10; i++) { await driver.persist(initializeRoomCache({ name: "three", roomId: "z" + i, clients: i, maxClients: 10, })); }

    // Test concurrent findOne queries
    const [res1, res2, res3, res4] = await Promise.all([
      driver.findOne({ name: "one" }),
      driver.findOne({ name: "two" }),
      driver.findOne({ name: "three" }),
      driver.findOne({ name: "three", clients: 3 }),
    ]);

    assert.strictEqual(res1.name, "one");
    assert.strictEqual(res2.name, "two");
    assert.strictEqual(res3.name, "three");
    assert.strictEqual(res4.clients, 3);
  });

  it("should filter and sort rooms using query()", async () => {
    // Clear any existing data
    driver.clear();

    await driver.persist(initializeRoomCache({ name: "game", roomId: "a1", clients: 5, maxClients: 10 }));
    await driver.persist(initializeRoomCache({ name: "game", roomId: "a2", clients: 3, maxClients: 10 }));
    await driver.persist(initializeRoomCache({ name: "game", roomId: "a3", clients: 8, maxClients: 10 }));
    await driver.persist(initializeRoomCache({ name: "lobby", roomId: "b1", clients: 2, maxClients: 10 }));

    // Test filtering
    const gameRooms = await driver.query({ name: "game" });
    assert.strictEqual(gameRooms.length, 3);
    assert.ok(gameRooms.every(r => r.name === "game"));

    // Test sorting ascending
    const sortedAsc = await driver.query({ name: "game" }, { clients: 1 });
    assert.strictEqual(sortedAsc[0].clients, 3);
    assert.strictEqual(sortedAsc[1].clients, 5);
    assert.strictEqual(sortedAsc[2].clients, 8);

    // Test sorting descending
    const sortedDesc = await driver.query({ name: "game" }, { clients: -1 });
    assert.strictEqual(sortedDesc[0].clients, 8);
    assert.strictEqual(sortedDesc[1].clients, 5);
    assert.strictEqual(sortedDesc[2].clients, 3);
  });

  it("should filter by metadata fields", async () => {
    // Clear any existing data
    driver.clear();

    await driver.persist(initializeRoomCache({ name: "game", roomId: "m1", clients: 1, maxClients: 10, metadata: { mode: "pvp", level: 5 } }));
    await driver.persist(initializeRoomCache({ name: "game", roomId: "m2", clients: 2, maxClients: 10, metadata: { mode: "pve", level: 3 } }));
    await driver.persist(initializeRoomCache({ name: "game", roomId: "m3", clients: 3, maxClients: 10, metadata: { mode: "pvp", level: 10 } }));

    // Filter by metadata field
    const pvpRooms = await driver.query({ name: "game", mode: "pvp" } as any);
    assert.strictEqual(pvpRooms.length, 2);
    assert.ok(pvpRooms.every(r => (r.metadata as any).mode === "pvp"));

    // FindOne with metadata filter
    const pveRoom = await driver.findOne({ name: "game", mode: "pve" } as any);
    assert.strictEqual((pveRoom.metadata as any).mode, "pve");
  });

});
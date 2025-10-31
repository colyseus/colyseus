import assert from "assert";
import { RedisDriver } from "@colyseus/redis-driver";
import { initializeRoomCache } from "@colyseus/core";

describe("RedisDriver", () => {
  let driver: RedisDriver;

  before(async () => {
    driver = new RedisDriver();
  });

  after(async () => {
    await driver.shutdown();
  });

  it("should allow concurrent queries to multiple room names", async () => {
    for (let i=0; i<10; i++) { await driver.persist(initializeRoomCache({ name: "one", roomId: "x" + i, clients: i, maxClients: 10, })); }
    for (let i=0; i<10; i++) { await driver.persist(initializeRoomCache({ name: "two", roomId: "y" + i, clients: i, maxClients: 10, })); }
    for (let i=0; i<10; i++) { await driver.persist(initializeRoomCache({ name: "three", roomId: "z" + i, clients: i, maxClients: 10, })); }

    const req1 = driver.findOne({ name: "one" });
    const concurrent = driver['_concurrentRoomCacheRequest'];

    const req2 = driver.findOne({ name: "two" });
    assert.strictEqual(concurrent, driver['_concurrentRoomCacheRequest']);

    const req3 = driver.findOne({ name: "three" });
    const concurrentByNameThree = driver['_roomCacheRequestByName']['three'];
    const req4 = driver.findOne({ name: "three", clients: 3 });
    assert.strictEqual(concurrent, driver['_concurrentRoomCacheRequest']);
    assert.strictEqual(concurrentByNameThree, driver['_roomCacheRequestByName']['three']);

    const [res1, res2, res3, res4] = await Promise.all([req1, req2, req3, req4]);

    assert.strictEqual(res1.name, "one");
    assert.strictEqual(res2.name, "two");
    assert.strictEqual(res3.name, "three");
    assert.strictEqual(res4.clients, 3);

    assert.ok(driver['_concurrentRoomCacheRequest'] === undefined);
  });

});
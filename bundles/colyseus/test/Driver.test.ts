import assert from "assert";
import { generateId, initializeRoomCache, LocalDriver, matchMaker, RedisDriver, type IRoomCache, type MatchMakerDriver } from "../src/index.ts";

import { DRIVERS } from "./utils/index.ts";

describe("Driver implementations", () => {
  for (let i = 0; i < DRIVERS.length; i++) {
    let driver: MatchMakerDriver;

    describe(`Driver:${DRIVERS[i].name}`, () => {
      before(async () => {
        driver = new DRIVERS[i]();

        // boot the driver if it has a boot method
        if (driver.boot) { await driver.boot(); }
      });

      // Make sure to clear driver's data after all tests run and shutdown
      after(async () => {
        await driver.clear();
        await driver.shutdown();
      });

      // Clear data before each test (reuse the same driver instance)
      beforeEach(async () => {
        await driver.clear();
      });

      async function createAndPersist(data: Partial<IRoomCache>) {
        const cache = initializeRoomCache(data);
        await driver.persist(cache, true);
        return cache;
      }

      it("createInstance, persist, find", async () => {
        const cache = await createAndPersist({ roomId: generateId(), name: "one", locked: false, clients: 0, maxClients: 2 });
        assert.strictEqual(0, cache.clients);
        assert.strictEqual(false, cache.locked);
        assert.strictEqual(2, cache.maxClients);

        const entries = await driver.query({ name: "one" });
        const cachedEntry = entries[0];
        assert.strictEqual(1, entries.length);
        assert.strictEqual(0, cachedEntry.clients);
        assert.strictEqual(false, cachedEntry.locked);
        assert.strictEqual(2, cachedEntry.maxClients);
      });

      it("find / findOne", async () => {
        await createAndPersist({ roomId: generateId(), name: "one", locked: false, clients: 1, maxClients: 2, });
        await createAndPersist({ roomId: generateId(), name: "one", locked: true, clients: 2, maxClients: 2, });
        await createAndPersist({ roomId: generateId(), name: "one", locked: false, clients: 3, maxClients: 4, });
        const lastEntry = await createAndPersist({ roomId: generateId(), name: "one", locked: true, clients: 4, maxClients: 4, });

        const entries = await driver.query({});
        assert.strictEqual(4, entries.length);

        lastEntry.clients = 3;
        lastEntry.locked = false;
        lastEntry.name = "hello";
        await driver.persist(lastEntry);

        const lastEntryCached = await driver.findOne({ name: "hello" })
        assert.strictEqual("hello", lastEntryCached.name);
        assert.strictEqual(3, lastEntryCached.clients);
        assert.strictEqual(false, lastEntryCached.locked);
      });

      it("remove", async () => {
        const cache1 = await createAndPersist({ roomId: generateId(), name: "one", locked: true, clients: 4, maxClients: 4 });
        const cache2 = await createAndPersist({ roomId: generateId(), name: "one", locked: false, clients: 2, maxClients: 4 });
        const cache3 = await createAndPersist({ roomId: generateId(), name: "one", locked: false, clients: 2, maxClients: 4 });

        await driver.persist(cache1);
        await driver.persist(cache2);
        await driver.persist(cache3);

        await driver.remove(cache1.roomId);
        await driver.remove(cache2.roomId);
        await driver.remove(cache3.roomId);

        const entries = await driver.query({});
        assert.strictEqual(0, entries.length)
      });

      describe("cleanup", () => {
        it("should remove 400 'stale' entries by processId", async () => {
          const p1 = generateId();
          const p2 = generateId();

          const count = 400;
          for (let i = 0; i < count; i++) {
            await createAndPersist({ name: "test1", processId: p1, roomId: generateId() });
            await createAndPersist({ name: "test1", processId: p2, roomId: generateId() });
          }

          assert.strictEqual(count, (await driver.query({ processId: p1 })).length);

          if (driver.cleanup) {
            await driver.cleanup(p1);
          }

          assert.strictEqual(0, (await driver.query({ processId: p1 })).length);
          assert.strictEqual(count, (await driver.query({ processId: p2 })).length);
        });

        it("should remove 600 'stale' entries by processId", async () => {
          const p1 = generateId();
          const p2 = generateId();

          const count = 600;
          for (let i = 0; i < count; i++) {
            await createAndPersist({ name: "test1", processId: p1, roomId: generateId() });
            await createAndPersist({ name: "test1", processId: p2, roomId: generateId() });
          }

          assert.strictEqual(count, (await driver.query({ processId: p1 })).length);

          if (driver.cleanup) {
            await driver.cleanup(p1);
          }

          assert.strictEqual(0, (await driver.query({ processId: p1 })).length);
          assert.strictEqual(count, (await driver.query({ processId: p2 })).length);
        });
      })

      describe("driver benchmark", () => {
        const LEVEL_NAMES = ["level1", "level2", "level3", "level4", "level5"];

        function createEntries(count: number) {
          const entries: Array<Promise<any>> = [];
          for (let i = 0; i < count; i++) {
            entries.push(createAndPersist({
              name: "test1",
              metadata: {
                level_name: LEVEL_NAMES[Math.floor(Math.random() * LEVEL_NAMES.length)],
              },
              processId: generateId(),
              roomId: generateId() 
            }));
          }

          return Promise.all(entries);
        }

        it("should persist 5000 entries in less than 1 second", async () => {
          const count = 5000;
          const createOperation = createEntries(count);

          const startTime = Date.now();
          await createOperation;
          const endTime = Date.now();

          const duration = endTime - startTime;
          console.log(`Persisted ${count} entries in ${duration}ms`);

          assert.ok(duration < 1000, `Expected to persist ${count} entries in less than 1 second, but took ${duration}ms`);
        });

        it("should filter 5000 entries in less than 60ms", async () => {
          await createEntries(5000);

          const startTime = Date.now();
          const entries = await driver.query({ level_name: "level1" });
          const endTime = Date.now();

          const duration = endTime - startTime;
          console.log(`Filtered ${entries.length} entries in ${duration}ms`);

          assert.ok(duration < 30, `Expected to filter ${entries.length} entries in less than 100ms, but took ${duration}ms`);
        });

      });

    });
  }
});

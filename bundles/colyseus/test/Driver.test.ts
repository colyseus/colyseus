import assert from "assert";
import { generateId, IRoomCache, MatchMakerDriver } from "../src";

import { DRIVERS } from "./utils";

describe("Driver implementations", () => {
  for (let i = 0; i < DRIVERS.length; i++) {
    let driver: MatchMakerDriver;

    describe(`Driver:${DRIVERS[i].name}`, () => {
      beforeEach(async () => {
        driver = new DRIVERS[i]();
        await driver.clear();
      });

      afterEach(async () => {
        await driver.shutdown();
      });

      async function createAndSave(data: Partial<IRoomCache>) {
        const cache = driver.createInstance(data);
        await cache.save();
        return cache;
      }

      it("createInstance, save, find", async () => {
        const cache = await createAndSave({ roomId: generateId(), name: "one", locked: false, clients: 0, maxClients: 2 });
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
        await createAndSave({ roomId: generateId(), name: "one", locked: false, clients: 1, maxClients: 2, });
        await createAndSave({ roomId: generateId(), name: "one", locked: true, clients: 2, maxClients: 2, });
        await createAndSave({ roomId: generateId(), name: "one", locked: false, clients: 3, maxClients: 4, });
        const lastEntry = await createAndSave({ roomId: generateId(), name: "one", locked: true, clients: 4, maxClients: 4, });

        const entries = await driver.query({});
        assert.strictEqual(4, entries.length);

        lastEntry.clients = 3;
        lastEntry.locked = false;
        lastEntry.name = "hello";
        await lastEntry.save();

        const lastEntryCached = await driver.findOne({ name: "hello" })
        assert.strictEqual("hello", lastEntryCached.name);
        assert.strictEqual(3, lastEntryCached.clients);
        assert.strictEqual(false, lastEntryCached.locked);
      });

      it("remove", async () => {
        const cache1 = await createAndSave({ roomId: generateId(), name: "one", locked: true, clients: 4, maxClients: 4 });
        const cache2 = await createAndSave({ roomId: generateId(), name: "one", locked: false, clients: 2, maxClients: 4 });
        const cache3 = await createAndSave({ roomId: generateId(), name: "one", locked: false, clients: 2, maxClients: 4 });

        await cache1.save();
        await cache2.save();
        await cache3.save();

        await cache1.remove();
        await cache2.remove();
        await cache3.remove();

        const entries = await driver.query({});
        assert.strictEqual(0, entries.length)
      });

      describe("cleanup", () => {
        it("should remove 400 'stale' entries by processId", async () => {
          const p1 = generateId();
          const p2 = generateId();

          const count = 400;
          for (let i = 0; i < count; i++) {
            await createAndSave({ processId: p1, roomId: generateId() });
            await createAndSave({ processId: p2, roomId: generateId() });
          }

          assert.strictEqual(count, (await driver.query({ processId: p1 })).length);

          await driver.cleanup(p1);

          assert.strictEqual(0, (await driver.query({ processId: p1 })).length);
          assert.strictEqual(count, (await driver.query({ processId: p2 })).length);
        });

        it("should remove 600 'stale' entries by processId", async () => {
          const p1 = generateId();
          const p2 = generateId();

          const count = 600;
          for (let i = 0; i < count; i++) {
            await createAndSave({ processId: p1, roomId: generateId() });
            await createAndSave({ processId: p2, roomId: generateId() });
          }

          assert.strictEqual(count, (await driver.query({ processId: p1 })).length);

          await driver.cleanup(p1);

          assert.strictEqual(0, (await driver.query({ processId: p1 })).length);
          assert.strictEqual(count, (await driver.query({ processId: p2 })).length);
        });
      })

    });
  }
});

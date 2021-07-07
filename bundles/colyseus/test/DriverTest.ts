import assert from "assert";
import { generateId, IRoomListingData, MatchMakerDriver } from "../src";

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

      async function createAndSave(data: Partial<IRoomListingData>) {
        const cache = driver.createInstance(data);
        await cache.save();
        return cache;
      }

      it("createInstance, save, find", async () => {
        const cache = await createAndSave({ roomId: generateId(), name: "one", locked: false, clients: 0, maxClients: 2 });
        assert.strictEqual(0, cache.clients);
        assert.strictEqual(false, cache.locked);
        assert.strictEqual(2, cache.maxClients);

        const entries = await driver.find({ name: "one" });
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

        const entries = await driver.find({});
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

    });
  }
});
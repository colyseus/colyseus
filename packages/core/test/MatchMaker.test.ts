import assert from "assert";
import { matchMaker } from "../src";

describe("MatchMaker", () => {

  describe("Stats", () => {
    it("should persist and fetch roomCount/ccu", async () => {
      matchMaker.setup();
      matchMaker.stats.local.roomCount = 10;
      matchMaker.stats.local.ccu = 100;
      await matchMaker.stats.persist();

      const all = await matchMaker.stats.fetchAll();
      assert.deepStrictEqual([{ processId: matchMaker.processId, roomCount: 10, ccu: 100 }], all);
      assert.strictEqual(100, await matchMaker.stats.getGlobalCCU());
    });
  });

});
import { matchMaker, Room } from "../src";
import { DummyRoom } from "./utils";
import assert from "assert";

describe("Room", () => {
  /**
   * register room types
   */
  before(() => {
    matchMaker.defineRoomType("dummy", DummyRoom);
  });

  /**
   * `setup` matchmaker to re-set graceful shutdown status
   */
  beforeEach(() => matchMaker.setup(undefined, undefined, 'dummyProcessId'));

  /**
   * ensure no rooms are avaialble in-between tests
   */
  afterEach(async () => await matchMaker.gracefullyShutdown());

});
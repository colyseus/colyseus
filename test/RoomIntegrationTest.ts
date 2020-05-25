import assert from "assert";
import * as Colyseus from "colyseus.js";

import { matchMaker, Room, Server, LocalPresence } from "../src";
import { timeout } from "./utils";

import { LocalDriver } from "../src/matchmaker/drivers/LocalDriver";

const TEST_PORT = 8567;
const TEST_ENDPOINT = `ws://localhost:${TEST_PORT}`;

describe("Room Integration", () => {
  const presence = new LocalPresence();
  const driver = new LocalDriver();

  const server = new Server({
    pingInterval: 150,
    pingMaxRetries: 1,
    presence,
    driver
  });

  const client = new Colyseus.Client(TEST_ENDPOINT);

  before(async () => {
    // setup matchmaker
    matchMaker.setup(presence, driver, 'dummyProcessId')

    // listen for testing
    await server.listen(TEST_PORT);
  });

  after(() => server.transport.shutdown());

  describe("FossilDeltaSerializer", () => {

    it("should transfer patches", async() => {
      matchMaker.defineRoomType('fossil-delta', class _ extends Room {
        onCreate() {
          this.setState({ hello: "world!" });
          this.onMessage("*", (_, type) => {
            this.state.hello = type;
          });
        }
      });

      const conn = await client.joinOrCreate('fossil-delta');
      await timeout(10);

      assert.deepEqual({ hello: "world!" }, conn.state, "receive initial state");
      conn.send("mutate");

      await timeout(50);
      assert.deepEqual({ hello: "mutate" }, conn.state, "receive patch");
    });

  });

});
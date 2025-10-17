import { Client as SDKClient } from "colyseus.js";

import { LocalDriver, matchMaker, Room, Server, LocalPresence } from "@colyseus/core";

const TEST_PORT = 8567;
const TEST_ENDPOINT = `ws://localhost:${TEST_PORT}`;

describe("Room Integration", () => {
  const presence = new LocalPresence();
  const driver = new LocalDriver();

  const server = new Server({
    greet: false,
    presence,
    driver
  });

  const client = new SDKClient(TEST_ENDPOINT);

  before(async () => {
    // setup matchmaker
    matchMaker.setup(presence, driver)

    // listen for testing
    await server.listen(TEST_PORT);
  });

  after(() => server.transport.shutdown());

});

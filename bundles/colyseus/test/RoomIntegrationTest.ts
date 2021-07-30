import assert from "assert";
import * as Colyseus from "colyseus.js";

import { LocalDriver, matchMaker, Room, Server, LocalPresence } from "@colyseus/core";
import { timeout } from "./utils";

const TEST_PORT = 8567;
const TEST_ENDPOINT = `ws://localhost:${TEST_PORT}`;

describe("Room Integration", () => {
  const presence = new LocalPresence();
  const driver = new LocalDriver();

  const server = new Server({
    presence,
    driver
  });

  const client = new Colyseus.Client(TEST_ENDPOINT);

  before(async () => {
    // setup matchmaker
    matchMaker.setup(presence, driver, 'dummyRoomIntegrationProcessId')

    // listen for testing
    await server.listen(TEST_PORT);
  });

  after(() => server.transport.shutdown());

});
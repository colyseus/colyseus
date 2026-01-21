import assert from "assert";
import { ColyseusSDK, MatchMakeError, ServerError } from "@colyseus/sdk";

import { matchMaker, ErrorCode,  LocalPresence, LocalDriver, defineServer, defineRoom, createRouter, createEndpoint } from "@colyseus/core";
import { DummyRoom, Room3Clients } from "../utils/index.ts";

import { z } from "zod";

const TEST_PORT = 8567;
const TEST_ENDPOINT = `ws://localhost:${TEST_PORT}`;

describe("SDK: HTTP", () => {
  let presence = new LocalPresence();
  let driver = new LocalDriver();

  let server = defineServer({
    rooms: {
      dummy: defineRoom(DummyRoom),
      room3: defineRoom(Room3Clients),
    },
    routes: createRouter({
      forbidden: createEndpoint("/forbidden", { method: "GET" }, async (ctx) => {
        if (ctx.request?.headers.get("Authorization") !== "Bearer token") {
          return ctx.error("FORBIDDEN", { message: "Forbidden error" });
        }
        return ctx.json({ message: "Hello world!" });
      }),
    }),
    presence,
    driver,
    greet: false,
    gracefullyShutdown: false,
  });

  const client = new ColyseusSDK<typeof server>(TEST_ENDPOINT);

  before(async () => {

    // setup matchmaker
    await matchMaker.setup(presence, driver);

    // define a room

    // listen for testing
    await server.listen(TEST_PORT);
  });

  beforeEach(async() => {
    await matchMaker.stats.reset();
    await driver.clear()
  });

  after(async () => {
    await driver.clear();
    await server.gracefullyShutdown(false);
  });

  describe("Errors", () => {
    it("should throw ServerError on 403 response", async () => {
      try {
        await client.http.get("/forbidden");
        assert.fail("Expected ServerError to be thrown");
      } catch (e) {
        if (e instanceof ServerError) {
          assert.ok(e.headers);
          assert.strictEqual(e.status, 403);
          assert.strictEqual(e.code, "FORBIDDEN_ERROR");
          assert.strictEqual(e.message, "Forbidden error");
          assert.deepStrictEqual(e.data, { code: 'FORBIDDEN_ERROR', message: 'Forbidden error' });
        } else {
          assert.fail("Expected ServerError to be thrown");
        }
      }
    });

    it("should throw MatchMakeError on invalid room name", async () => {
      try {
        await client.joinOrCreate("invalid_room_name");
        assert.fail("Expected MatchMakeError to be thrown");
      } catch (e) {
        if (e instanceof MatchMakeError) {
          assert.strictEqual(e.code, ErrorCode.MATCHMAKE_NO_HANDLER);
        } else {
          assert.fail("Expected MatchMakeError to be thrown");
        }
      }
    });
  });


});

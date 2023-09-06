import * as httpClient from "httpie";
import assert from "assert";

import { Server, matchMaker } from "@colyseus/core";
import { DummyRoom } from "./utils";
import { URL } from "url";

describe("Server", () => {

  const server = new Server({greet: false});

  // bind & unbind server
  before(async () => new Promise((resolve) => {
    // setup matchmaker
    matchMaker.setup(undefined, undefined)

    // define a room
    server.define("roomName", DummyRoom);

    // listen for testing
    server.listen(8567, undefined, undefined, resolve);
  }));

  after(() => server.transport.shutdown());

  describe("matchmaking routes", () => {

    it("should respond to GET /matchmake/ to retrieve list of rooms", async () => {
      const response = await httpClient.get("http://localhost:8567/matchmake/");
      assert.deepEqual(response.data, []);
    });

    it("should respond to POST /matchmake/joinOrCreate/roomName", async () => {
      const { data } = await httpClient.post("http://localhost:8567/matchmake/joinOrCreate/roomName", {
        body: "{}"
      });

      assert.ok(data.sessionId);
      assert.ok(data.room);
      assert.ok(data.room.processId);
      assert.ok(data.room.roomId);
      assert.equal(data.room.name, 'roomName');
    });


  });

  describe("API", () => {
    it("server.define() should throw error if argument is invalid", () => {
      assert.throws(() => server.define("dummy", undefined));
    });
  });

  describe("CORS headers", () => {
    let originalGetCorsHeaders = matchMaker.controller.getCorsHeaders;
    after(() => matchMaker.controller.getCorsHeaders = originalGetCorsHeaders);

    it("should allow to customize getCorsHeaders()", async () => {
      let refererHeader: string;

      matchMaker.controller.getCorsHeaders = function (req) {
        const referer = new URL(req.headers.referer);

        if (referer.hostname !== "safedomain.com") {
          refererHeader = "safedomain.com";

        } else {
          refererHeader = referer.hostname;

        }

        return {
          'Access-Control-Allow-Origin': refererHeader,
        }
      };

      await httpClient.post("http://localhost:8567/matchmake/joinOrCreate/roomName", {
        body: "{}",
        headers: { referer: "https://safedomain.com/page" }
      });

      assert.strictEqual("safedomain.com", refererHeader);
    });

  });

});

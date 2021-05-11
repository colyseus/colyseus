import * as httpClient from "httpie";
import assert from "assert";

import { Server, matchMaker } from "../src";
import { DummyRoom } from "./utils";

describe("Server", () => {

  const server = new Server();

  // bind & unbind server
  before(async () => new Promise((resolve) => {
    // setup matchmaker
    matchMaker.setup(undefined, undefined, 'dummyProcessId')

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

});
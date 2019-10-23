import * as httpClient from "httpie";
import assert from "assert";
import { Server } from "../src";

describe("Server", () => {

  describe("matchmaking routes", () => {
    const server = new Server();

    // bind & unbind server
    before(async () => new Promise(resolve => server.listen(8567, undefined, undefined, resolve)));
    after(() => server.transport.shutdown());

    it("should respond to GET /matchmake/ to retrieve list of rooms", async () => {
      const response = await httpClient.get("http://localhost:8567/matchmake/");
      assert.deepEqual(response.data, []);
    });

    xit("should respond to POST /matchmake/roomName", async () => {
      const response = await httpClient.post("http://localhost:8567/matchmake/");
      assert.deepEqual(response.data, []);
    });

  });


});
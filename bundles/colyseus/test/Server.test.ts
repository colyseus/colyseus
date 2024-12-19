import * as httpClient from "httpie";
import assert from "assert";

import * as Colyseus from "colyseus.js";
import { Deferred, Room, Server, matchMaker } from "@colyseus/core";
import { DummyRoom } from "./utils";
import { URL } from "url";
import { Schema, type } from "@colyseus/schema";

const TEST_PORT = 8567;
const TEST_ENDPOINT = `ws://localhost:${TEST_PORT}`;

describe("Server", () => {

  const server = new Server({greet: false});
  const client = new Colyseus.Client(TEST_ENDPOINT);

  // bind & unbind server
  before(async () => new Promise((resolve) => {
    // setup matchmaker
    matchMaker.setup(undefined, undefined)

    // define a room
    server.define("roomName", DummyRoom);

    // listen for testing
    server.listen(TEST_PORT, undefined, undefined, resolve);
  }));

  after(async () => {
    await matchMaker.gracefullyShutdown();
    await server.transport.shutdown()
  });

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

    describe("server.simulateLatency", () => {
      it("should synchronize state with delay", async () => {
        class Item extends Schema {
          @type("string") name: string;
        }

        class MyState extends Schema {
          @type("string") message: string = "Hello world!";
          @type({ map: Item }) items = new Map<string, Item>();
        }

        matchMaker.defineRoomType('latency_state', class _ extends Room {
          onCreate() {
            this.setState(new MyState());
            this.state.items.set("zero", new Item().assign({ name: "zero" }));
          }
          onJoin() {
            this.state.items.set("one", new Item().assign({ name: "one" }));
          }
        });

        server.simulateLatency(50);

        const connection = await client.joinOrCreate('latency_state');

        await new Promise((resolve) => setTimeout(resolve, 100));

        assert.deepStrictEqual(connection.state.toJSON(), {
          message: 'Hello world!',
          items: { zero: { name: 'zero' }, one: { name: 'one' } }
        })
      });

      it("clients should receive messages at least after X ms of latency", async () => {
        const LATENCY = 300;
        const HALF_LATENCY = LATENCY / 2; // that's how simulateLatency works
        const timeout = 30;

        let startedAt = 0;
        let receivedOnServerAt = 0;
        let receivedOnClientAt = 0;
        let running = new Deferred();
        let elapsedTimeForRequest = 0;
        let elapsedTimeForResponse = 0;

        matchMaker.defineRoomType('onmessage', class _ extends Room {
          onCreate() {
            this.onMessage("request", (client) => {
              receivedOnServerAt = Date.now();
              client.send('response');
            });
          }
        });

        server.simulateLatency(LATENCY);

        const connection = await client.joinOrCreate('onmessage');
        connection.onMessage('response', () => {
          receivedOnClientAt = Date.now();
          running.resolve(true);
        });

        startedAt = Date.now();
        connection.send("request");

        await running;

        elapsedTimeForRequest = receivedOnServerAt - startedAt;
        elapsedTimeForResponse = receivedOnClientAt - receivedOnServerAt;

        assert.ok(elapsedTimeForRequest >= HALF_LATENCY, `latency for outgoing messages should be at least ${HALF_LATENCY}ms, got: ${elapsedTimeForRequest}ms`);
        assert.ok(elapsedTimeForRequest < (HALF_LATENCY + timeout), `latency for outgoing messages should be at most ${HALF_LATENCY + timeout}ms, got: ${elapsedTimeForRequest}ms`);

        assert.ok(elapsedTimeForResponse >= HALF_LATENCY, `latency for incoming messages should be at least ${HALF_LATENCY}ms, got: ${elapsedTimeForResponse}ms`);
        assert.ok(elapsedTimeForResponse < (HALF_LATENCY + timeout), `latency for incoming messages should be at most ${HALF_LATENCY + timeout}ms, got: ${elapsedTimeForResponse}ms`);

        await connection.leave();
      });

      it("only the latest call of simulateLatency should be applied", async () => {
        const LATENCY = 300;
        const HALF_LATENCY = LATENCY / 2; // that's how simulateLatency works
        const timeout = 30;

        let startedAt = 0;
        let receivedOnServerAt = 0;
        let receivedOnClientAt = 0;
        let running = new Deferred();
        let elapsedTimeForRequest = 0;
        let elapsedTimeForResponse = 0;

        matchMaker.defineRoomType('onmessage', class _ extends Room {
          onCreate() {
            this.onMessage("request", (client) => {
              receivedOnServerAt = Date.now();
              client.send('response', '');
            });
          }
        });

        server.simulateLatency(1500); // first call
        server.simulateLatency(LATENCY); // last call

        const connection = await client.joinOrCreate('onmessage');
        connection.onMessage('response', () => {
          receivedOnClientAt = Date.now();
          running.resolve(true);
        });

        startedAt = Date.now();
        connection.send("request", '');

        await running;

        elapsedTimeForRequest = receivedOnServerAt - startedAt;
        elapsedTimeForResponse = receivedOnClientAt - receivedOnServerAt;

        assert.ok(elapsedTimeForRequest >= HALF_LATENCY, `latency for outgoing messages should be at least ${HALF_LATENCY}ms, got: ${elapsedTimeForRequest}ms`);
        assert.ok(elapsedTimeForRequest < (HALF_LATENCY + timeout), `latency for outgoing messages should be at most ${HALF_LATENCY + timeout}ms, got: ${elapsedTimeForRequest}ms`);

        assert.ok(elapsedTimeForResponse >= HALF_LATENCY, `latency for incoming messages should be at least ${HALF_LATENCY}ms, got: ${elapsedTimeForResponse}ms`);
        assert.ok(elapsedTimeForResponse < (HALF_LATENCY + timeout), `latency for incoming messages should be at most ${HALF_LATENCY + timeout}ms, got: ${elapsedTimeForResponse}ms`);

        await connection.leave();
      });

      it("passing latency <= 0 should disable simulate latency", async () => {
        const LATENCY = 300;
        const timeout = 30;

        let startedAt = 0;
        let receivedOnServerAt = 0;
        let receivedOnClientAt = 0;
        let running = new Deferred();
        let elapsedTimeForRequest = 0;
        let elapsedTimeForResponse = 0;

        matchMaker.defineRoomType('onmessage', class _ extends Room {
          onCreate() {
            this.onMessage("request", (client) => {
              receivedOnServerAt = Date.now();
              client.send('response', '');
            });
          }
        });

        server.simulateLatency(LATENCY); // enable
        server.simulateLatency(0); // disable

        const connection = await client.joinOrCreate('onmessage');
        connection.onMessage('response', () => {
          receivedOnClientAt = Date.now();
          running.resolve(true);
        });

        startedAt = Date.now();
        connection.send("request", '');

        await running;

        elapsedTimeForRequest = receivedOnServerAt - startedAt;
        elapsedTimeForResponse = receivedOnClientAt - receivedOnServerAt;

        assert.ok(elapsedTimeForRequest < timeout, `latency for outgoing messages should be at most ${timeout}ms, got: ${elapsedTimeForRequest}ms`);
        assert.ok(elapsedTimeForResponse < timeout, `latency for incoming messages should be at most ${timeout}ms, got: ${elapsedTimeForResponse}ms`);

        await connection.leave();
      });
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

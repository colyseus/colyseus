import * as httpClient from "httpie";
import assert from "assert";

import * as Colyseus from "@colyseus/sdk";
import { Deferred, Room, Server, matchMaker } from "@colyseus/core";
import { DummyRoom } from "./utils/index.ts";
import { URL } from "url";
import { Schema, type, schema, t, type SchemaType } from "@colyseus/schema";

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

    it("should respond to POST /matchmake/joinOrCreate/roomName", async () => {
      const { data } = await httpClient.post("http://localhost:8567/matchmake/joinOrCreate/roomName", {
        body: "{}"
      });

      assert.ok(data.sessionId);
      assert.ok(data.processId);
      assert.ok(data.roomId);
      assert.equal(data.name, 'roomName');
    });


  });

  describe("API", () => {
    it("server.define() should throw error if argument is invalid", () => {
      // @ts-ignore
      assert.throws(() => server.define("dummy", undefined));
    });

    describe("server.simulateLatency", () => {
      // dispose rooms between tests: these all reuse the 'onmessage' room name,
      // so a leftover room would be re-joined and run the previous test's handlers
      afterEach(async () => {
        await Promise.all(matchMaker.disconnectAll());
      });

      it("should synchronize state with delay", async () => {
        const Item = schema({
          name: t.string(),
        });
        type Item = SchemaType<typeof Item>;

        const MyState = schema({
          message: t.string().default("Hello world!"),
          items: t.map(Item),
        });
        type MyState = SchemaType<typeof MyState>;

        matchMaker.defineRoomType('latency_state', class _ extends Room {
          state = new MyState();
          onCreate() {
            this.state.items.set("zero", new Item().assign({ name: "zero" }));
          }
          onJoin() {
            this.state.items.set("one", new Item().assign({ name: "one" }));
          }
        });

        server.simulateLatency(50);

        const connection = await client.joinOrCreate<MyState>('latency_state');

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
        const TOLERANCE = 5; // setTimeout can fire a hair early under load

        let startedAt = 0;
        let receivedOnServerAt = 0;
        let receivedOnClientAt = 0;
        let running = new Deferred();
        let elapsedTimeForRequest = 0;
        let elapsedTimeForResponse = 0;

        matchMaker.defineRoomType('onmessage_recv', class _ extends Room {
          onCreate() {
            this.onMessage("request", (client) => {
              receivedOnServerAt = Date.now();
              client.send('response');
            });
          }
        });

        server.simulateLatency(LATENCY);

        const connection = await client.joinOrCreate('onmessage_recv');
        connection.onMessage('response', () => {
          receivedOnClientAt = Date.now();
          running.resolve(true);
        });

        startedAt = Date.now();
        connection.send("request");

        await running;

        elapsedTimeForRequest = receivedOnServerAt - startedAt;
        elapsedTimeForResponse = receivedOnClientAt - receivedOnServerAt;

        assert.ok(elapsedTimeForRequest >= HALF_LATENCY - TOLERANCE, `latency for outgoing messages should be at least ${HALF_LATENCY}ms, got: ${elapsedTimeForRequest}ms`);
        assert.ok(elapsedTimeForRequest < (HALF_LATENCY + timeout), `latency for outgoing messages should be at most ${HALF_LATENCY + timeout}ms, got: ${elapsedTimeForRequest}ms`);

        assert.ok(elapsedTimeForResponse >= HALF_LATENCY - TOLERANCE, `latency for incoming messages should be at least ${HALF_LATENCY}ms, got: ${elapsedTimeForResponse}ms`);
        assert.ok(elapsedTimeForResponse < (HALF_LATENCY + timeout), `latency for incoming messages should be at most ${HALF_LATENCY + timeout}ms, got: ${elapsedTimeForResponse}ms`);

        await connection.leave();
      });

      it("only the latest call of simulateLatency should be applied", async () => {
        const LATENCY = 300;
        const HALF_LATENCY = LATENCY / 2; // that's how simulateLatency works
        const timeout = 30;
        const TOLERANCE = 5; // setTimeout can fire a hair early under load

        let startedAt = 0;
        let receivedOnServerAt = 0;
        let receivedOnClientAt = 0;
        let running = new Deferred();
        let elapsedTimeForRequest = 0;
        let elapsedTimeForResponse = 0;

        matchMaker.defineRoomType('onmessage_latest', class _ extends Room {
          onCreate() {
            this.onMessage("request", (client) => {
              receivedOnServerAt = Date.now();
              client.send('response', '');
            });
          }
        });

        server.simulateLatency(1500); // first call
        server.simulateLatency(LATENCY); // last call

        const connection = await client.joinOrCreate('onmessage_latest');
        connection.onMessage('response', () => {
          receivedOnClientAt = Date.now();
          running.resolve(true);
        });

        startedAt = Date.now();
        connection.send("request", '');

        await running;

        elapsedTimeForRequest = receivedOnServerAt - startedAt;
        elapsedTimeForResponse = receivedOnClientAt - receivedOnServerAt;

        assert.ok(elapsedTimeForRequest >= HALF_LATENCY - TOLERANCE, `latency for outgoing messages should be at least ${HALF_LATENCY}ms, got: ${elapsedTimeForRequest}ms`);
        assert.ok(elapsedTimeForRequest < (HALF_LATENCY + timeout), `latency for outgoing messages should be at most ${HALF_LATENCY + timeout}ms, got: ${elapsedTimeForRequest}ms`);

        assert.ok(elapsedTimeForResponse >= HALF_LATENCY - TOLERANCE, `latency for incoming messages should be at least ${HALF_LATENCY}ms, got: ${elapsedTimeForResponse}ms`);
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

        matchMaker.defineRoomType('onmessage_disable', class _ extends Room {
          onCreate() {
            this.onMessage("request", (client) => {
              receivedOnServerAt = Date.now();
              client.send('response', '');
            });
          }
        });

        server.simulateLatency(LATENCY); // enable
        server.simulateLatency(0); // disable

        const connection = await client.joinOrCreate('onmessage_disable');
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

  describe("options.database", () => {
    it("awaits database.boot() before accepting; eager pre-boot shares one run", async () => {
      let bootCalls = 0;
      let bootResolved = false;

      const stubDatabase = {
        async boot() {
          bootCalls += 1;
          await new Promise((r) => setTimeout(r, 25));
          bootResolved = true;
        },
      };

      let cached: Promise<void> | undefined;
      const idempotent = {
        boot() { return cached ??= stubDatabase.boot(); },
      };

      const orderObserved: string[] = [];

      const localServer = new Server({
        greet: false,
        database: idempotent,
        beforeListen: () => { orderObserved.push("beforeListen"); },
        express: () => {
          orderObserved.push("express");
          assert.ok(bootResolved);
        },
      });

      const eager = idempotent.boot();
      orderObserved.push("eagerFired");

      await localServer.listen(TEST_PORT + 1);
      await eager;

      assert.strictEqual(bootCalls, 1);
      assert.deepStrictEqual(orderObserved, ["eagerFired", "beforeListen", "express"]);

      await localServer.transport.shutdown();
    });
  });

  describe("options.auth (no database)", () => {
    it("auto-mounts @colyseus/auth routes when a router is supplied", async () => {
      const { createRouter } = await import("@colyseus/core");
      const localServer = new Server({
        greet: false,
        gracefullyShutdown: false,
        auth: {
          settings: {
            onFindUserByEmail: async () => null,
            onRegisterWithEmailAndPassword: async () => ({ id: 1 }),
          },
        },
      });
      localServer.router = createRouter({}) as any;
      await localServer.listen(TEST_PORT + 2);

      const response = await fetch(`http://localhost:${TEST_PORT + 2}/auth/anonymous`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      assert.strictEqual(response.status, 200);
      const data = await response.json();
      assert.ok(data.user?.anonymousId);
      assert.ok(data.token);

      await localServer.transport.shutdown();
    });

    it("auto-mounts even when no `routes` was passed to defineServer", async () => {
      const localServer = new Server({
        greet: false,
        gracefullyShutdown: false,
        auth: {
          settings: {
            onFindUserByEmail: async () => null,
            onRegisterWithEmailAndPassword: async () => ({ id: 1 }),
          },
        },
      });
      // No localServer.router assignment — listen() must bootstrap one.
      await localServer.listen(TEST_PORT + 3);

      const response = await fetch(`http://localhost:${TEST_PORT + 3}/auth/anonymous`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      assert.strictEqual(response.status, 200);
      const data = await response.json();
      assert.ok(data.user?.anonymousId);
      assert.ok(data.token);

      await localServer.transport.shutdown();
    });
  });

  describe("CORS headers", () => {
    let originalGetCorsHeaders = matchMaker.controller.getCorsHeaders;
    after(() => matchMaker.controller.getCorsHeaders = originalGetCorsHeaders);

    it("should allow to customize getCorsHeaders()", async () => {
      let refererHeader!: string;

      matchMaker.controller.getCorsHeaders = function (headers: Headers) {
        const referer = new URL(headers.get('referer') || '');

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

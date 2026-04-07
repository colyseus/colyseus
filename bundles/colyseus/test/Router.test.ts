/**
 * Regression test for https://github.com/colyseus/colyseus/issues/930
 *
 * GET endpoints with query params return 404 when Express app is present.
 * Root cause: `router.findRoute(req.method, req.url)` in bindRouterToTransport
 * receives the full URL with query string, but rou3 doesn't strip query params
 * before matching — so it returns undefined, falling through to Express → 404.
 */
import assert from "assert";
import { ColyseusSDK } from "@colyseus/sdk";
import { LocalPresence, LocalDriver, matchMaker, defineServer, defineRoom, createRouter, createEndpoint, Room } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { uWebSocketsTransport } from "@colyseus/uwebsockets-transport";
import z from "zod";

class DummyRoom extends Room {
  onCreate() {}
  onJoin() {}
  onLeave() {}
  onDispose() {}
}

const routes = createRouter({
  resources: createEndpoint("/api/v1/resources", {
    method: "GET", 
    query: z.object({
      lat: z.string().optional(),
      lng: z.string().optional(), 
    }),
  }, async (ctx) => {
    const lat = ctx.query.lat;
    const lng = ctx.query.lng;
    return { lat: Number(lat), lng: Number(lng) };
  }),
});

const TRANSPORTS = [
  { name: "ws-transport", create: () => new WebSocketTransport() },
  { name: "uWebSocketsTransport", create: () => new uWebSocketsTransport() },
];

const TEST_PORT = 8567;

describe("Router - query string handling (issue #930)", () => {
  for (const { name, create } of TRANSPORTS) {
    describe(`Transport: ${name}`, () => {

      describe("with express app", () => {
        let server: ReturnType<typeof defineServer>;
        let client: ColyseusSDK;

        before(async () => {
          server = defineServer({
            greet: false,
            gracefullyShutdown: false,
            presence: new LocalPresence(),
            driver: new LocalDriver(),
            transport: create(),
            rooms: { dummy: defineRoom(DummyRoom) },
            routes,
            express: (app) => {
              app.get("/express-route", (req, res) => {
                res.json({ source: "express" });
              });
            },
          });

          await matchMaker.setup(new LocalPresence(), new LocalDriver());
          await server.listen(TEST_PORT);
          client = new ColyseusSDK(`ws://localhost:${TEST_PORT}`);
        });

        after(async () => {
          await server.gracefullyShutdown(false);
        });

        it("GET /api/v1/resources (no query params) should return 200", async () => {
          const res = await client.http.get("/api/v1/resources");
          assert.strictEqual(res.status, 200);
        });

        it("GET /api/v1/resources?lat=49.96&lng=8.79 should return 200", async () => {
          const res = await client.http.get("/api/v1/resources?lat=49.96&lng=8.79");
          assert.strictEqual(res.status, 200);
          assert.deepStrictEqual(res.data, { lat: 49.96, lng: 8.79 });
        });

        it("GET /api/v1/resources?lat=0&lng=0 should return 200", async () => {
          const res = await client.http.get("/api/v1/resources?lat=0&lng=0");
          assert.strictEqual(res.status, 200);
          assert.deepStrictEqual(res.data, { lat: 0, lng: 0 });
        });

        it("express routes should still work alongside createEndpoint routes", async () => {
          const res = await client.http.get("/express-route");
          assert.strictEqual(res.status, 200);
          assert.deepStrictEqual(res.data, { source: "express" });
        });
      });

      describe("without express app", () => {
        let server: ReturnType<typeof defineServer>;
        let client: ColyseusSDK;

        before(async () => {
          server = defineServer({
            greet: false,
            gracefullyShutdown: false,
            presence: new LocalPresence(),
            driver: new LocalDriver(),
            transport: create(),
            rooms: { dummy: defineRoom(DummyRoom) },
            routes,
          });

          await matchMaker.setup(new LocalPresence(), new LocalDriver());
          await server.listen(TEST_PORT);
          client = new ColyseusSDK(`ws://localhost:${TEST_PORT}`);
        });

        after(async () => {
          await server.gracefullyShutdown(false);
        });

        it("GET /api/v1/resources (no query params) should return 200", async () => {
          const res = await client.http.get("/api/v1/resources");
          assert.strictEqual(res.status, 200);
        });

        it("GET /api/v1/resources?lat=49.96&lng=8.79 should return 200", async () => {
          const res = await client.http.get("/api/v1/resources?lat=49.96&lng=8.79");
          assert.strictEqual(res.status, 200);
          assert.deepStrictEqual(res.data, { lat: 49.96, lng: 8.79 });
        });
      });

    });
  }
});

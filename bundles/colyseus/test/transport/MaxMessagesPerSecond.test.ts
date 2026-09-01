import assert from "assert";
import { LocalPresence, LocalDriver, matchMaker, Room, Server, CloseCode, type Transport } from "../../src/index.ts";
import { timeout } from "../utils/index.ts";

import { Client as SDKClient } from "@colyseus/sdk";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { uWebSocketsTransport } from "@colyseus/uwebsockets-transport";

const TEST_PORT = 8571;
const TEST_ENDPOINT = `ws://localhost:${TEST_PORT}`;

/**
 * Rate limiting lives in `Room._onMessage`, but the counters it increments
 * are per-client. Each transport ships its own `Client` implementation, so
 * this runs the same scenario against every one of them.
 */
const TRANSPORTS: Array<[string, () => Transport]> = [
  ["ws-transport", () => new WebSocketTransport({})],
  ["uwebsockets-transport", () => new uWebSocketsTransport({})],
];

describe("maxMessagesPerSecond (per transport)", () => {
  for (const [name, createTransport] of TRANSPORTS) {
    describe(name, () => {
      let server: Server;
      let presence: LocalPresence;
      let driver: LocalDriver;

      before(async () => {
        presence = new LocalPresence();
        driver = new LocalDriver();
        server = new Server({ greet: false, gracefullyShutdown: false, presence, driver, transport: createTransport() });
        await matchMaker.setup(presence, driver);

        server.define('limited', class _ extends Room {
          onCreate() {
            this.maxMessagesPerSecond = 3;
            this.onMessage("*", () => {});
          }
        });

        await server.listen(TEST_PORT);
      });

      after(async () => {
        await server.gracefullyShutdown(false);
        await driver.shutdown();
      });

      beforeEach(async () => await matchMaker.setup(presence, driver));

      it("disconnects a client that exceeds the limit", async () => {
        const conn = await new SDKClient(TEST_ENDPOINT).joinOrCreate('limited');

        let onLeaveCode: number | undefined;
        conn.onLeave((code) => onLeaveCode = code);

        for (let i = 0; i < 20; i++) { conn.send("msg", i); }
        await timeout(100);

        assert.strictEqual(onLeaveCode, CloseCode.WITH_ERROR);
      });

      it("keeps a client that stays within the limit", async () => {
        const conn = await new SDKClient(TEST_ENDPOINT).joinOrCreate('limited');

        let disconnected = false;
        conn.onLeave(() => disconnected = true);

        conn.send("msg", 1);
        conn.send("msg", 2);
        await timeout(100);

        assert.strictEqual(disconnected, false);
        await conn.leave();
      });
    });
  }
});

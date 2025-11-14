import assert from "assert";
import crypto from "crypto";
import sinon from "sinon";
import { ColyseusSDK, Room as SDKRoom } from "@colyseus/sdk";
import { type Client,  type MatchMakerDriver, type Presence, matchMaker, Room, Server, Transport, LocalDriver, LocalPresence } from "@colyseus/core";

import WebSocket from "ws";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { timeout } from "./utils/index.ts";

const TEST_PORT = 8567;
const TEST_ENDPOINT = `ws://localhost:${TEST_PORT}`;

describe("Room Reconnection", () => {
  let driver: MatchMakerDriver;
  let server: Server;
  let presence: Presence;
  let transport: Transport;

  const client = new ColyseusSDK(TEST_ENDPOINT);

  function setupReconnection(conn: SDKRoom) {
    conn.reconnection.minDelay = 0;
    conn.reconnection.minUptime = 0;
    conn.reconnection.backoff = (attempt: number, delay: number) => 0;
  }

  before(async () => {
    driver = new LocalDriver();
    presence = new LocalPresence()
    transport = new WebSocketTransport({ pingInterval: 100, pingMaxRetries: 3, });

    server = new Server({ greet: false, gracefullyShutdown: false, presence, driver, transport, });

    // setup matchmaker
    await matchMaker.setup(presence, driver);

    // listen for testing
    await server.listen(TEST_PORT);
  });

  beforeEach(async() => {
    await matchMaker.stats.reset();
    await driver.clear()
  });

  after(async () => {
    await server.gracefullyShutdown(false);
    await driver.clear();
  });

  describe("Auto-reconnection", () => {

    it("should reconnect on abnormal closure", async () => {
      matchMaker.defineRoomType('auto_reconnect', class _ extends Room {
        messages = {
          dummy(client: Client, message: any) {}
        }
        onJoin(client: Client, options: any) {
          // simulate abnormal closure
          // @ts-ignore
          setTimeout(() => client['ref']._socket.destroy(), 50);
        }
        async onLeave(client: Client, consented: boolean) {
          console.log("onLeave!", client.sessionId, { consented });
          try {
            if (consented) { throw new Error("consented"); }
            await this.allowReconnection(client, 10)
          } catch (e) {
            // Reconnection failed or timed out
          }
        }
      });

      const conn = await client.joinOrCreate('auto_reconnect', { string: "hello", number: 1 });
      setupReconnection(conn);

      await timeout(50); // wait for the connection to be abnormally closure
      assert.strictEqual(false, conn.connection.isOpen);

      await timeout(100); // wait for the reconnection to happen
      assert.strictEqual(true, conn.connection.isOpen);

      const room = matchMaker.getLocalRoomById(conn.roomId);
      assert.strictEqual(room.roomId, conn.roomId);

      await conn.leave();

      await timeout(50);
      assert.ok(!matchMaker.getLocalRoomById(conn.roomId));
    });

  });

});

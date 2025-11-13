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
        sessionIds: Map<string, Client> = new Map();
        messages = {
          dummy(client: Client, message: any) {
            console.log("dummy", client);
          }
        }
        onJoin(client: Client, options: any) {
          console.log("onJoin", client.sessionId);
          this.sessionIds.set(client.sessionId, client);
          // simulate abnormal closure
          // @ts-ignore
          setTimeout(() => console.log(client['ref']._socket.destroy()), 1);
        }
        onLeave(client: Client, consented: boolean) {
          console.log("onLeave!", client.sessionId, { consented });
          this.sessionIds.delete(client.sessionId);
        }
      });

      const conn = await client.joinOrCreate('auto_reconnect', { string: "hello", number: 1 });

      await timeout(100);

      const ws: WebSocket = (conn.connection.transport as any).ws;

      const room = matchMaker.getRoomById(conn.roomId);

      // await conn.leave();
    });

  });

});

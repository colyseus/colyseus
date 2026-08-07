//
// Repro for https://github.com/colyseus/colyseus/issues/950
//
// When the old connection is still considered alive by the server (e.g. a
// proxy swallowed the client's WS close frame), the reconnect flow takes the
// force-close path in `checkReconnectionToken()`. If `onDrop` *awaits*
// `allowReconnection()`, the deferred `client.leave()` from
// `#_forciblyCloseClient` runs after `previousClient.ref` has been
// transplanted with the freshly reconnected socket — killing it with 4002.
//
import assert from "assert";
import { ColyseusSDK } from "@colyseus/sdk";
import { type Client, type MatchMakerDriver, type Presence, matchMaker, Room, Server, Transport, LocalDriver, LocalPresence } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { timeout } from "./utils/index.ts";

const TEST_PORT = 8571;
const TEST_ENDPOINT = `ws://localhost:${TEST_PORT}`;

describe("Issue #950: deferred leave() kills reconnected client when onDrop awaits allowReconnection", () => {
  let driver: MatchMakerDriver;
  let server: Server;
  let presence: Presence;
  let transport: Transport;

  const client = new ColyseusSDK(TEST_ENDPOINT);

  before(async () => {
    driver = new LocalDriver();
    presence = new LocalPresence();
    transport = new WebSocketTransport({ pingInterval: 100, pingMaxRetries: 3 });
    server = new Server({ greet: false, gracefullyShutdown: false, presence, driver, transport });
    await matchMaker.setup(presence, driver);
    await server.listen(TEST_PORT);
  });

  beforeEach(async () => {
    await matchMaker.stats.reset();
    await driver.clear();
  });

  after(async () => {
    await server.gracefullyShutdown(false);
    await driver.clear();
  });

  it("awaited allowReconnection: reconnected client should survive the stale force-close", async () => {
    const events: string[] = [];

    matchMaker.defineRoomType('issue_950', class _ extends Room {
      async onDrop(client: Client, code: number) {
        events.push(`onDrop ${code}`);
        try {
          await this.allowReconnection(client, 10);
          events.push('reconnected');
        } catch (e) {
          events.push('reconnection expired');
        }
      }
      async onReconnect(client: Client) {
        events.push('onReconnect');
      }
      async onLeave(client: Client, code: number) {
        events.push(`onLeave ${code}`);
      }
    });

    const conn = await client.joinOrCreate('issue_950');
    const reconnectionToken = conn.reconnectionToken;
    const originalSessionId = conn.sessionId;

    // do NOT close `conn`: simulates a proxy swallowing the close frame —
    // the server still believes the old connection is alive when the
    // reconnect request arrives.
    const newConn = await client.reconnect(reconnectionToken);

    let newConnLeaveCode: number | undefined;
    newConn.onLeave((code) => newConnLeaveCode = code);

    // give time for the deferred leave() to (wrongly) fire
    await timeout(100);

    assert.strictEqual(originalSessionId, newConn.sessionId, "sessionId should be preserved");
    assert.deepStrictEqual(events, ['onDrop 4002', 'onReconnect', 'reconnected'],
      `unexpected server event sequence: ${JSON.stringify(events)}`);
    assert.strictEqual(newConnLeaveCode, undefined, "reconnected client should not have been closed");
    assert.strictEqual(true, newConn.connection.isOpen, "reconnected connection should remain open");

    await newConn.leave();
    await timeout(50);
  });
});

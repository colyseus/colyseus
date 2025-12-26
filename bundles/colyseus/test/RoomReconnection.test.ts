import assert from "assert";
import crypto from "crypto";
import sinon from "sinon";
import { CloseCode, ColyseusSDK, getStateCallbacks, Room as SDKRoom } from "@colyseus/sdk";
import { type Client,  type MatchMakerDriver, type Presence, matchMaker, Room, Server, Transport, LocalDriver, LocalPresence, Deferred } from "@colyseus/core";

import WebSocket from "ws";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { timeout } from "./utils/index.ts";
import { schema, type SchemaType } from "@colyseus/schema";

const TEST_PORT = 8567;
const TEST_ENDPOINT = `ws://localhost:${TEST_PORT}`;

function simulateAbnormalClosure(client: Client) {
  // @ts-ignore
  setTimeout(() => client['ref']._socket.destroy(), 50);
}

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
      let onDropCalled = false;
      let onReconnectCalled = false;
      let onLeaveCalled = false;
      matchMaker.defineRoomType('auto_reconnect', class _ extends Room {
        onJoin(client: Client, options: any) {
          // simulate abnormal closure
          simulateAbnormalClosure(client);
        }
        async onDrop(client: Client, code: number) {
          onDropCalled = true;
          this.allowReconnection(client, 10);
        }
        async onReconnect(client: Client) {
          onReconnectCalled = true;
        }
        async onLeave(client: Client, code: number) {
          onLeaveCalled = true;
        }
      });

      const conn = await client.joinOrCreate('auto_reconnect', { string: "hello", number: 1 });
      setupReconnection(conn);

      // wait for the connection to be abnormally closure
      await new Promise((resolve) => conn.onDrop.once((code, reason) => resolve(true)));

      // wait a tiny bit for server-side onDrop to be called
      await timeout(1);

      assert.strictEqual(false, conn.connection.isOpen);
      assert.strictEqual(onDropCalled, true);
      assert.strictEqual(onLeaveCalled, false);
      assert.strictEqual(onReconnectCalled, false);

      // wait for the reconnection to happen
      await new Promise((resolve) => conn.onReconnect.once(() => resolve(true)));
      assert.strictEqual(true, conn.connection.isOpen);
      assert.strictEqual(onDropCalled, true);
      assert.strictEqual(onLeaveCalled, false);
      assert.strictEqual(onReconnectCalled, true);

      const room = matchMaker.getLocalRoomById(conn.roomId);
      assert.strictEqual(room.roomId, conn.roomId);

      await conn.leave();

      await timeout(50);
      assert.strictEqual(onDropCalled, true);
      assert.strictEqual(onLeaveCalled, true);
      assert.strictEqual(onReconnectCalled, true);

      assert.ok(!matchMaker.getLocalRoomById(conn.roomId));
    });

    it("should send enqueued messages after reconnecting", async () => {
      type MessageType = { index: number };

      const receivedMessages: Array<MessageType> = [];
      matchMaker.defineRoomType('reconnect_with_enqueued_messages', class _ extends Room {
        messages = {
          test(client: Client, message: MessageType) {
            receivedMessages.push(message);
          }
        }
        onJoin(client: Client, options: any) {
          // simulate abnormal closure
          simulateAbnormalClosure(client);
        }
        onDrop(client: Client, code: number) {
          this.allowReconnection(client, 10);
        }
        onReconnect(client: Client) { }
        onLeave(client: Client, code: number) { }
      });

      const conn = await client.joinOrCreate('reconnect_with_enqueued_messages');
      setupReconnection(conn);

      let onDropCode: number | undefined = undefined;
      let onDropReason: string | undefined = undefined;
      await new Promise((resolve) => conn.onDrop.once((code, reason) => {
        onDropCode = code;
        onDropReason = reason;
        resolve(true);
      }));
      assert.strictEqual(false, conn.connection.isOpen);

      assert.strictEqual(onDropCode, CloseCode.ABNORMAL_CLOSURE);
      assert.strictEqual(onDropReason, "");

      // send 20 messages (default maxEnqueuedMessages is 10)
      for (let i = 0; i < 20; i++) { conn.send("test", { index: i }); }

      // wait for the reconnection to happen
      await new Promise((resolve) => conn.onReconnect.once(() => resolve(true)));

      assert.strictEqual(true, conn.connection.isOpen);

      await timeout(50);

      assert.strictEqual(receivedMessages.length, 10, "should receive offline enqueued messages");
      assert.deepStrictEqual(receivedMessages.map(message => message.index), Array.from({ length: 10 }, (_, i) => 10 + i), "should receive messages in the correct order");

      assert.strictEqual(matchMaker.getLocalRoomById(conn.roomId).roomId, conn.roomId);

      await conn.leave();

      await timeout(50);
      assert.ok(!matchMaker.getLocalRoomById(conn.roomId));
    });

    it("state sync: should keep callbacks and not trigger them twice for existing items", async () => {
      const Item = schema({
        name: "string",
      });

      const Player = schema({
        items: [Item],
        connected: "boolean",
      });

      const State = schema({
        players: { map: Player },
      });
      type State = SchemaType<typeof State>;

      matchMaker.defineRoomType('state_sync_existing_items', class _ extends Room {
        state = new State();
        onCreate() {
          for (let i = 0; i < 10; i++) {
            this.state.players.set(`player${i}`, new Player().assign({ items: [new Item().assign({ name: `item${i}` })] }));
          }
        }
        async onJoin(client: Client, options: any) {
          this.state.players.set(client.sessionId, new Player().assign({ items: [new Item().assign({ name: `item${client.sessionId}` })] }));
        }
        onDrop(client: Client, code: number) {
          this.allowReconnection(client, 10);
          this.state.players.get(client.sessionId)!.connected = false;
        }
        onReconnect(client: Client) {
          this.state.players.get(client.sessionId)!.connected = true;
          this.state.players.get(client.sessionId)!.items.push(new Item().assign({ name: `item${client.sessionId}` }));
        }
        onLeave(client: Client, code: CloseCode) {
          this.state.players.delete(client.sessionId);
        }
      });

      const conn = await client.joinOrCreate<State>('state_sync_existing_items');
      setupReconnection(conn);

      const $ = getStateCallbacks(conn);
      let onPlayerAddCount = 0;
      let onItemAddCount = 0;
      $(conn.state).players.onAdd((player, key) => {
        onPlayerAddCount++;
        $(player.items).onAdd((item, key) => { onItemAddCount++; });
      });

      await new Promise((resolve) => conn.onStateChange.once((state) => resolve(true)));

      assert.strictEqual(onPlayerAddCount, 11);
      assert.strictEqual(onItemAddCount, 11);

      conn.leave(false);
      await new Promise((resolve) => conn.onDrop.once((code, reason) => resolve(true)));
      assert.strictEqual(false, conn.connection.isOpen);

      await new Promise((resolve) => conn.onReconnect.once(() => resolve(true)));
      assert.strictEqual(true, conn.connection.isOpen);

      await new Promise((resolve) => conn.onStateChange.once((state) => resolve(true)));
      assert.strictEqual(onPlayerAddCount, 11);
      assert.strictEqual(onItemAddCount, 12);
    });

    describe("onLeave should be backwards-compatible", () => {
      it("should allow to reconnect with onLeave + allowReconnection", async () => {
        let onLeaveCalled = false;
        let onReconnectSuccess = false;
        let onDropCalled = false;

        matchMaker.defineRoomType('backwards_compatible_onleave', class _ extends Room {
          onJoin(client: Client, options: any) {
            // simulate abnormal closure
            simulateAbnormalClosure(client);
          }
          async onLeave(client: Client, code: CloseCode) {
            onLeaveCalled = true;
            console.log("onLeave", { code });
            try {
              if (code === CloseCode.CONSENTED) { throw new Error("consented"); }
              onDropCalled = true;
              await this.allowReconnection(client, 10);
              onReconnectSuccess = true;
            } catch (e: any) {
              // Reconnection failed or timed out. This is expected.
            }
          }
        });

        const conn = await client.joinOrCreate('backwards_compatible_onleave');
        setupReconnection(conn);

        // Wait for client-side drop event
        await new Promise((resolve) => conn.onDrop.once((code, reason) => resolve(true)));

        // Connection should be closed immediately after onDrop
        assert.strictEqual(false, conn.connection.isOpen);

        // Wait for reconnection to complete
        await new Promise((resolve) => conn.onReconnect.once(() => resolve(true)));

        // After reconnection, verify all callbacks were triggered properly
        assert.strictEqual(true, conn.connection.isOpen);
        assert.strictEqual(onDropCalled, true);
        assert.strictEqual(onLeaveCalled, true);
        assert.strictEqual(onReconnectSuccess, true);
      });

      it("should NOT allow to reconnect with onLeave + allowReconnection if reconnection got cancelled", async () => {
        let onLeaveCalled = false;
        let onReconnectCancelled = false;
        let onDropCalled = false;

        matchMaker.defineRoomType('backwards_compatible_onleave_reconnection_cancelled', class _ extends Room {
          async onLeave(client: Client, code: CloseCode) {
            onLeaveCalled = true;
            try {
              if (code === CloseCode.CONSENTED) { throw new Error("consented"); }
              onDropCalled = true;

              const reconnection = this.allowReconnection(client, "manual");
              setTimeout(() => {
                reconnection.reject(new Error("reconnection rejected"));
              }, 1);

              await reconnection;

            } catch (e: any) {
              onReconnectCancelled = true;
            }
          }
        });

        const conn = await client.joinOrCreate('backwards_compatible_onleave_reconnection_cancelled');
        conn.leave(false);

        await new Promise((resolve) => conn.onDrop.once((code, reason) => resolve(true)));
        await timeout(1);
        assert.strictEqual(false, conn.connection.isOpen);
        assert.strictEqual(onDropCalled, true);
        assert.strictEqual(onLeaveCalled, true);

        await timeout(10);
        assert.strictEqual(onReconnectCancelled, true);
      });
    });

  });

});

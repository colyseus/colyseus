import assert from "assert";
import { Deferred, LocalPresence, matchMaker, type MatchMakerDriver, type Presence, Room, Server } from "../../src/index.ts";
import { DRIVERS } from "../utils/index.ts";

import { uWebSocketsTransport, uWebSocketClient } from "@colyseus/uwebsockets-transport";

import WebSocket from "ws";

const TEST_PORT = 8567;
const TEST_ENDPOINT = `ws://localhost:${TEST_PORT}`;

describe("Transport: uWebSockets.js", () => {
  for (let i = 0; i < DRIVERS.length; i++) {
    describe(`Driver: ${DRIVERS[i].name}`, () => {

      let driver: MatchMakerDriver;
      let server: Server;
      let presence: Presence = new LocalPresence();

      /**
       * register room types
       */
      before(async () => {
        driver = new DRIVERS[i]();

        server = new Server({
          greet: false,
          presence,
          driver,
          transport: new uWebSocketsTransport({
            idleTimeout: 8,
            sendPingsAutomatically: false,
          })
          // transport: new WebSocketTransport({
          //   pingInterval: 1000,
          //   pingMaxRetries: 2,
          // })
        });

        matchMaker.setup(presence, driver);

        await server.listen(TEST_PORT);
      });

      // make sure driver is cleared out and shutdown.
      after(async () => {
        server.transport.shutdown();
        await driver.shutdown();
      });

      /**
       * `setup` matchmaker to re-set graceful shutdown status
       */
      beforeEach(async () => {
        await matchMaker.setup(presence, driver);
        await matchMaker.accept();
      });

      /**
       * ensure no rooms are avaialble in-between tests
       */
      afterEach(async () => await matchMaker.gracefullyShutdown());

      it("early disconnect should call onJoin and onLeave", async () => {
        let onJoinCalled = false;
        let onLeaveCalled = false;

        matchMaker.defineRoomType("dummy", class _ extends Room {
          onCreate() {}
          onJoin() {
            onJoinCalled = true;
          }
          async onLeave() {
            await new Promise((resolve) => setTimeout(resolve, 50));
            onLeaveCalled = true;
          }
        });

        // Quickly close WebSocket connetion before onAuth completes
        const seatReservation = await matchMaker.joinOrCreate('dummy', {});
        const connection = new WebSocket(`${TEST_ENDPOINT}/${seatReservation.processId}/${seatReservation.roomId}?sessionId=${seatReservation.sessionId}`);
        connection.on("open", () => connection.close());

        await new Promise((resolve) => setTimeout(resolve, 100));

        assert.strictEqual(connection.readyState, WebSocket.CLOSED);
        assert.strictEqual(true, onJoinCalled);
        assert.strictEqual(true, onLeaveCalled);
      });

      it("should not crash when sending to a client whose uWS socket was closed", async () => {
        /**
         * Reproduces: "Invalid access of closed uWS.WebSocket/SSLWebSocket"
         *
         * When uWS internally closes a socket (TCP drop, client kill, etc.),
         * there is a window between the actual close and the JS close callback
         * where readyState is still OPEN but the socket is dead.
         *
         * We simulate this by resetting readyState to OPEN after the client
         * has disconnected, then calling raw() — which would throw and crash
         * the process without the try/catch fix.
         */
        let serverClient: uWebSocketClient | null = null;
        const onJoinCalled = new Deferred();
        const onLeaveCalled = new Deferred();

        matchMaker.defineRoomType("send_closed_ws", class _ extends Room {
          onCreate() {}
          onJoin(client: any) {
            serverClient = client;
            onJoinCalled.resolve();
          }
          async onLeave() {
            onLeaveCalled.resolve();
          }
        });

        const seatReservation = await matchMaker.joinOrCreate('send_closed_ws', {});
        const connection = new WebSocket(`${TEST_ENDPOINT}/${seatReservation.processId}/${seatReservation.roomId}?sessionId=${seatReservation.sessionId}`);

        await onJoinCalled;
        await new Promise<void>((resolve) => connection.on("open", resolve));

        // Abruptly kill the connection
        connection.terminate();
        await onLeaveCalled;

        // Simulate the race condition: socket is dead but readyState
        // hasn't been updated yet (uWS closed the socket internally
        // but the JS close callback hasn't fired yet)
        serverClient!.readyState = 1; // ReadyState.OPEN

        // Without the try/catch fix in raw(), this throws
        // "Invalid access of closed uWS.WebSocket/SSLWebSocket" and crashes
        assert.doesNotThrow(() => {
          serverClient!.raw(new Uint8Array([1, 2, 3]));
        });

        // The catch handler should have updated readyState to CLOSED
        assert.strictEqual(serverClient!.readyState, 3); // ReadyState.CLOSED
      });

      it("should not crash when calling leave() on an already-closed uWS socket", async () => {
        let serverClient: uWebSocketClient | null = null;
        const onJoinCalled = new Deferred();
        const onLeaveCalled = new Deferred();

        matchMaker.defineRoomType("leave_closed_ws", class _ extends Room {
          onCreate() {}
          onJoin(client: any) {
            serverClient = client;
            onJoinCalled.resolve();
          }
          async onLeave() {
            onLeaveCalled.resolve();
          }
        });

        const seatReservation = await matchMaker.joinOrCreate('leave_closed_ws', {});
        const connection = new WebSocket(`${TEST_ENDPOINT}/${seatReservation.processId}/${seatReservation.roomId}?sessionId=${seatReservation.sessionId}`);

        await onJoinCalled;
        await new Promise<void>((resolve) => connection.on("open", resolve));

        connection.terminate();
        await onLeaveCalled;

        // Simulate the race condition for leave()
        serverClient!.readyState = 1; // ReadyState.OPEN

        // Without the try/catch fix in leave(), this would crash
        assert.doesNotThrow(() => {
          serverClient!.leave(1000);
        });

        // The catch handler should have updated readyState to CLOSED
        assert.strictEqual(serverClient!.readyState, 3); // ReadyState.CLOSED
      });

      it("idleTimeout: inactive socket should disconnect and call onLeave", async () => {
        let onJoinCalled = false;
        let onLeaveCalled = false;

        matchMaker.defineRoomType('idle', class _ extends Room {
          onCreate() {}
          onJoin() {
            onJoinCalled = true;
          }
          async onLeave() {
            await new Promise((resolve) => setTimeout(resolve, 50));
            onLeaveCalled = true;
          }
        });

        // Quickly close WebSocket connetion before onAuth completes
        const seatReservation = await matchMaker.joinOrCreate('idle', {});
        const connection = new WebSocket(`${TEST_ENDPOINT}/${seatReservation.processId}/${seatReservation.roomId}?sessionId=${seatReservation.sessionId}`);

        let onOpenCalled = false;
        let onCloseCalled = false;
        connection.on("open", () => onOpenCalled = true);
        connection.on("close", () => onCloseCalled = true);
        connection.on("ping", () => console.log("CLIENT RECEIVED PING"));

        await new Promise((resolve) => setTimeout(resolve, 9000));

        assert.strictEqual(true, onOpenCalled);
        assert.strictEqual(true, onCloseCalled);
        assert.strictEqual(connection.readyState, WebSocket.CLOSED);

        assert.strictEqual(true, onJoinCalled);
        assert.strictEqual(true, onLeaveCalled);
      });

    });

  }
});

import assert from "assert";
import { Deferred, LocalPresence, matchMaker, MatchMakerDriver, Presence, Room, Server } from "../../src";
import { DRIVERS } from "../utils";

import { uWebSocketsTransport } from "@colyseus/uwebsockets-transport";

import * as Colyseus from "colyseus.js";
import WebSocket from "ws";
import { WebSocketTransport } from "@colyseus/ws-transport";

const TEST_PORT = 8567;
const TEST_ENDPOINT = `ws://localhost:${TEST_PORT}`;
const client = new Colyseus.Client(TEST_ENDPOINT);

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

      // make sure driver is cleared out.
      after(() => server.transport.shutdown());

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
        const connection = new WebSocket(`${TEST_ENDPOINT}/${seatReservation.room.processId}/${seatReservation.room.roomId}?sessionId=${seatReservation.sessionId}`);
        connection.on("open", () => connection.close());

        await new Promise((resolve) => setTimeout(resolve, 100));

        assert.strictEqual(connection.readyState, WebSocket.CLOSED);
        assert.strictEqual(true, onJoinCalled);
        assert.strictEqual(true, onLeaveCalled);
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
        const connection = new WebSocket(`${TEST_ENDPOINT}/${seatReservation.room.processId}/${seatReservation.room.roomId}?sessionId=${seatReservation.sessionId}`);

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

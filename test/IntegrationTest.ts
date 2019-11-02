import assert from "assert";
import * as Colyseus from "colyseus.js";

import { matchMaker, Room, Client, Server } from "../src";
import { DummyRoom, DRIVERS, awaitForTimeout, createDummyClient } from "./utils";

describe("Integration", () => {
  for (let i = 0; i < DRIVERS.length; i++) {
    const driver = DRIVERS[i];

    describe(`Using driver: ${(driver.constructor as any).name}`, () => {
      const server = new Server();
      const client = new Colyseus.Client("ws://localhost:8567");

      before(async () => new Promise((resolve) => {
        // setup matchmaker
        matchMaker.setup(undefined, driver, 'dummyProcessId')

        // define a room
        server.define("roomName", DummyRoom);

        // listen for testing
        server.listen(8567, undefined, undefined, resolve);
      }));

      after(() => server.transport.shutdown());

      describe("Room lifecycle", () => {
        after(() => {
          matchMaker.removeRoomType('oncreate');
          matchMaker.removeRoomType('onjoin');
        });

        it("onCreate()", async () => {
          let onCreateCalled = false;

          matchMaker.defineRoomType('oncreate', class _ extends Room {
            onCreate(options) {
              assert.deepEqual({ string: "hello", number: 1 }, options);
              onCreateCalled = true;
            }
            onMessage(client, message) { }
          });

          const connection = await client.joinOrCreate('oncreate', { string: "hello", number: 1 });
          assert.ok(onCreateCalled);

          await connection.leave();
        });

        it("async onCreate()", async () => {
          let onCreateCalled = false;

          matchMaker.defineRoomType('oncreate', class _ extends Room {
            async onCreate(options) {
              return new Promise(resolve => setTimeout(() => {
                onCreateCalled = true;
                resolve();
              }, 100)
              );
            }
            onMessage(client, message) { }
          });

          const connection = await client.joinOrCreate('oncreate', { string: "hello", number: 1 });
          assert.ok(onCreateCalled);

          await connection.leave();
        });

        it("onJoin()", async () => {
          let onJoinCalled = false;

          matchMaker.defineRoomType('onjoin', class _ extends Room {
            onJoin(client: Client, options: any) {
              onJoinCalled = true;
              assert.deepEqual({ string: "hello", number: 1 }, options);
            }
            onMessage(client, message) { }
          });

          const connection = await client.joinOrCreate('onjoin', { string: "hello", number: 1 });
          assert.ok(onJoinCalled);

          await connection.leave();
        });

        it("async onJoin()", async () => {
          let onJoinCalled = false;

          matchMaker.defineRoomType('onjoin', class _ extends Room {
            async onJoin(client: Client, options: any) {
              return new Promise(resolve => setTimeout(() => {
                onJoinCalled = true;
                resolve();
              }, 100));
            }
            onMessage(client, message) { }
          });

          const connection = await client.joinOrCreate('onjoin');
          assert.ok(onJoinCalled);

          await connection.leave();
        });

      });

    });

  }
});
import assert from "assert";
import * as Colyseus from "colyseus.js";
import { Schema, type } from "@colyseus/schema";

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

        it("onLeave()", async () => {
          let onLeaveCalled = false;

          matchMaker.defineRoomType('onleave', class _ extends Room {
            onLeave(client: Client, options: any) {
              onLeaveCalled = true;
            }
            onMessage(client, message) { }
          });

          const connection = await client.joinOrCreate('onleave');
          await connection.leave();

          await awaitForTimeout(50);
          assert.ok(onLeaveCalled);
        });

        it("async onLeave()", async () => {
          let onLeaveCalled = false;

          matchMaker.defineRoomType('onleave', class _ extends Room {
            async onLeave(client: Client, options: any) {
              return new Promise(resolve => setTimeout(() => {
                onLeaveCalled = true;
                resolve();
              }, 100));
            }
            onMessage(client, message) { }
          });

          const connection = await client.joinOrCreate('onleave');
          await connection.leave();

          await awaitForTimeout(150);
          assert.ok(onLeaveCalled);
        });

        it("onDispose()", async () => {
          let onDisposeCalled = false;

          matchMaker.defineRoomType('onleave', class _ extends Room {
            onDispose() {
              onDisposeCalled = true;
            }
            onMessage(client, message) { }
          });

          const connection = await client.joinOrCreate('onleave');
          await connection.leave();

          await awaitForTimeout(50);
          assert.ok(!matchMaker.getRoomById(connection.id))
          assert.ok(onDisposeCalled);
        });

        it("async onDispose()", async () => {
          let onDisposeCalled = false;

          matchMaker.defineRoomType('onleave', class _ extends Room {
            async onDispose() {
              return new Promise(resolve => setTimeout(() => {
                onDisposeCalled = true;
                resolve();
              }, 100));
            }
            onMessage(client, message) { }
          });

          const connection = await client.joinOrCreate('onleave');
          await connection.leave();

          await awaitForTimeout(150);
          assert.ok(!matchMaker.getRoomById(connection.id))
          assert.ok(onDisposeCalled);
        });

        it("onMessage()", async () => {
          const messageToSend = {
            string: "hello",
            number: 10,
            float: Math.PI,
            array: [1,2,3,4,5],
            nested: {
              string: "hello",
              number: 10,
              float: Math.PI,
            }
          };

          let onMessageCalled = false;
          let sessionId: string;

          matchMaker.defineRoomType('onmessage', class _ extends Room {
            onMessage(client: Client, message: any) {
              sessionId = client.sessionId;
              assert.deepEqual(messageToSend, message);
              onMessageCalled = true;
            }
          });

          const connection = await client.joinOrCreate('onmessage');
          connection.send(messageToSend);
          await awaitForTimeout(20);

          await connection.leave();

          assert.equal(sessionId, connection.sessionId);
          assert.ok(onMessageCalled);
        });

        describe("setPatchRate()", () => {
          class PatchState extends Schema {
            @type("number") number: number = 0;
          }

          it("should receive patch at every patch rate", async () => {
            matchMaker.defineRoomType('patchinterval', class _ extends Room {
              onCreate(options: any) {
                this.setState(new PatchState());
                this.setPatchRate(20);
                this.setSimulationInterval(() => this.state.number++);
              }
              onMessage() {}
            });

            const connection = await client.create('patchinterval');
            let patchesReceived: number = 0;

            connection.onStateChange(() => patchesReceived++);

            await awaitForTimeout(20 * 25);
            assert.ok(patchesReceived > 20, "should have received > 20 patches");

            connection.leave();
            await awaitForTimeout(50);
          });

          it("should not receive any patch if patchRate is nullified", async () => {
            matchMaker.defineRoomType('patchinterval', class _ extends Room {
              onCreate(options: any) {
                this.setState(new PatchState());
                this.setPatchRate(null);
                this.setSimulationInterval(() => this.state.number++);
              }
              onMessage() {}
            });

            const connection = await client.create<PatchState>('patchinterval');
            let patchesReceived: number = 0;

            connection.onStateChange(() => patchesReceived++);

            await awaitForTimeout(500);

            // simulation interval may have run a short amount of cycles for the first ROOM_STATE message
            assert.ok(connection.state.number <= 2);
            assert.equal(0, patchesReceived);

            connection.leave();
            await awaitForTimeout(50);
          });

        });

        describe("broadcast()", () => {
          it("all clients should receive broadcast data", async () => {
            matchMaker.defineRoomType('broadcast', class _ extends Room {
              maxClients = 3;
              onMessage(client: Client, message: any) {
                this.broadcast(message);
              }
            });

            const messages: string[] = [];

            const conn1 = await client.joinOrCreate('broadcast');
            conn1.onMessage(message => messages.push(message));

            const conn2 = await client.joinOrCreate('broadcast');
            conn2.onMessage(message => messages.push(message));

            const conn3 = await client.joinOrCreate('broadcast');
            conn3.onMessage(message => messages.push(message));

            conn1.send("one");
            conn2.send("two");
            conn3.send("three");

            await awaitForTimeout(200);

            assert.deepEqual(['one', 'two', 'three', 'one', 'two', 'three', 'one', 'two', 'three'], messages);

            conn1.leave();
            conn2.leave();
            conn3.leave();
            await awaitForTimeout(50);
          });

          it("should broadcast except to specific client", async () => {
            matchMaker.defineRoomType('broadcast', class _ extends Room {
              maxClients = 3;
              onMessage(client: Client, message: any) {
                this.broadcast(message, { except: client });
              }
            });

            const messages: string[] = [];

            const conn1 = await client.joinOrCreate('broadcast');
            conn1.onMessage(message => messages.push(message));

            const conn2 = await client.joinOrCreate('broadcast');
            conn2.onMessage(message => messages.push(message));

            const conn3 = await client.joinOrCreate('broadcast');
            conn3.onMessage(message => messages.push(message));

            conn1.send("one");
            conn2.send("two");
            conn3.send("three");

            await awaitForTimeout(200);

            assert.deepEqual(['one', 'two', 'one', 'three', 'two', 'three'], messages);

            conn1.leave();
            conn2.leave();
            conn3.leave();
            await awaitForTimeout(50);
          });

          xit("should broadcast after patch", async () => {
            // TODO
          });

        });

        describe("disconnect()", () => {

          it("should disconnect all clients", async() => {
            matchMaker.defineRoomType('disconnect', class _ extends Room {
              maxClients = 2;
              onCreate() {
                this.clock.setTimeout(() => this.disconnect(), 100);
              }
              onMessage() {}
            });

            let disconnected: number = 0;
            const conn1 = await client.joinOrCreate('disconnect');
            conn1.onLeave(() => disconnected++);

            const conn2 = await client.joinOrCreate('disconnect');
            conn2.onLeave(() => disconnected++);

            assert.equal(conn1.id, conn2.id, "should've joined the same room");

            await awaitForTimeout(150);
            assert.equal(2, disconnected, "both clients should've been disconnected");
          });


        });

      });

    });

  }
});
import assert from "assert";
import sinon from "sinon";
import * as Colyseus from "colyseus.js";
import { Schema, type, Context } from "@colyseus/schema";

import { matchMaker, Room, Client, Server } from "../src";
import { DummyRoom, DRIVERS, timeout, Room3Clients, PRESENCE_IMPLEMENTATIONS, Room2Clients, Room2ClientsExplicitLock } from "./utils";
import { MatchMakeError } from "../src/MatchMaker";

import WebSocket from "ws";

const TEST_PORT = 8567;
const TEST_ENDPOINT = `ws://localhost:${TEST_PORT}`;

describe("Integration", () => {
  for (let i = 0; i < PRESENCE_IMPLEMENTATIONS.length; i++) {
    const presence = PRESENCE_IMPLEMENTATIONS[i];

    for (let j = 0; j < DRIVERS.length; j++) {
      const driver = DRIVERS[j];

      describe(`Driver => ${(driver.constructor as any).name}, Presence => ${presence.constructor.name}`, () => {
        const server = new Server({
          pingInterval: 150,
          pingMaxRetries: 1,
          presence,
          driver
        });

        const client = new Colyseus.Client(TEST_ENDPOINT);

        before(async () => {
          // setup matchmaker
          matchMaker.setup(presence, driver, 'dummyProcessId')

          // define a room
          server.define("dummy", DummyRoom);
          server.define("room3", Room3Clients);

          // listen for testing
          await server.listen(TEST_PORT);
        });

        after(() => server.transport.shutdown());

        describe("Room lifecycle", () => {
          // after(() => {
          //   matchMaker.removeRoomType('oncreate');
          //   matchMaker.removeRoomType('onjoin');
          // });

          describe("onCreate()", () => {
            it("sync onCreate()", async () => {
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

              // assert 'presence' implementation
              const room = matchMaker.getRoomById(connection.id);
              assert.equal(presence, room.presence);

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
          });

          describe("onJoin()", () => {
            it("sync onJoin()", async () => {
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

            it("async onJoin support", async () => {
              let onJoinCalled = false;

              matchMaker.defineRoomType('onjoin', class _ extends Room {
                async onJoin(client: Client, options: any) {
                  return new Promise(resolve => setTimeout(() => {
                    onJoinCalled = true;
                    resolve();
                  }, 20));
                }
                onMessage(client, message) { }
              });

              const connection = await client.joinOrCreate('onjoin');
              await timeout(50);
              assert.ok(onJoinCalled);

              await connection.leave();
            });

            it("error during onJoin should reject client-side promise", async () => {
              matchMaker.defineRoomType('onjoin', class _ extends Room {
                async onJoin(client: Client, options: any) {
                  throw new MatchMakeError("not_allowed");
                }
                onMessage(client, message) { }
              });

              await assert.rejects(async () => await client.joinOrCreate('onjoin'));
            });

            it("should discard connections when early disconnected", async () => {
              matchMaker.defineRoomType('onjoin', class _ extends Room {
                async onJoin(client: Client, options: any) {
                  return new Promise((resolve) => setTimeout(resolve, 100));
                }
                onMessage(client, message) { }
              });

              // keep one active connection to prevent room's disposal
              const activeConnection = await client.joinOrCreate("onjoin");

              const seatReservation = await matchMaker.joinOrCreate('onjoin', {});
              const room = matchMaker.getRoomById(seatReservation.room.roomId);

              const lostConnection = new WebSocket(`${TEST_ENDPOINT}/${seatReservation.room.processId}/${seatReservation.room.roomId}?sessionId=${seatReservation.sessionId}`);

              // close connection immediatelly after connecting.
              lostConnection.on("open", () => lostConnection.close());

              await timeout(110);

              const rooms = await matchMaker.query({ name: "onjoin" });

              assert.equal(1, room.clients.length);
              assert.equal(1, rooms[0].clients);

              await activeConnection.leave();
              await timeout(50);
            });
          });

          it("onAuth() error should reject join promise", async() => {
            matchMaker.defineRoomType('onauth', class _ extends Room {
              async onAuth(client: Client, options: any) {
                throw new MatchMakeError("not_allowed");
              }
              onMessage(client, message) { }
            });

            await assert.rejects(async () => await client.joinOrCreate('onauth'));
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

            await timeout(50);
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

            await timeout(150);
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

            await timeout(50);
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

            await timeout(150);
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
            await timeout(20);

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

              const connection = await client.create<PatchState>('patchinterval');
              let patchesReceived: number = 0;

              connection.onStateChange(() => patchesReceived++);

              await timeout(20 * 25);
              assert.ok(patchesReceived > 20, "should have received > 20 patches");
              assert.ok(connection.state.number >= 20);

              connection.leave();
              await timeout(50);
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
              let stateChangeCount: number = 0;

              connection.onStateChange(() => stateChangeCount++);

              await timeout(500);

              // simulation interval may have run a short amount of cycles for the first ROOM_STATE message
              assert.equal(1, stateChangeCount);

              connection.leave();
              await timeout(50);
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

              await timeout(200);

              assert.deepEqual(["one", "one", "one", "three", "three", "three", "two", "two", "two"], messages.sort());

              conn1.leave();
              conn2.leave();
              conn3.leave();
              await timeout(50);
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

              await timeout(200);

              assert.deepEqual(["one", "one", "three", "three", "two", "two"], messages.sort());

              conn1.leave();
              conn2.leave();
              conn3.leave();
              await timeout(50);
            });

            it("should allow to broadcast during onJoin() for current client", async () => {
              matchMaker.defineRoomType('broadcast', class _ extends Room {
                onJoin(client, options) {
                  this.broadcast("hello");
                }
                onMessage(client, message) { }
              });

              const conn = await client.joinOrCreate('broadcast');

              let onMessageCalled = false;
              let message: any;

              conn.onMessage((_message) => {
                onMessageCalled = true;
                message = _message;
              });

              await timeout(300);

              assert.equal(true, onMessageCalled);
              assert.equal("hello", message);

              conn.leave();
            });

            it("should broadcast after patch", async () => {
              class DummyState extends Schema {
                @type("number") number: number = 0;
              }

              matchMaker.defineRoomType('broadcast_afterpatch', class _ extends Room {
                onCreate() {
                  this.setPatchRate(100);
                  this.setState(new DummyState);
                }
                onJoin(client, options) {
                  this.broadcast("hello", { afterNextPatch: true });
                  this.state.number = 1;
                }
                onMessage(client, message) { }
              });

              const conn = await client.joinOrCreate('broadcast_afterpatch');

              let onMessageCalled = false;
              let message: any;

              conn.onMessage((_message) => {
                onMessageCalled = true;
                message = _message;
              });

              await timeout(50);

              assert.equal(false, onMessageCalled);

              await timeout(100);

              assert.equal(true, onMessageCalled);
              assert.equal("hello", message);

              conn.leave();
            });

          });

          describe("send()", () => {

            it("send() schema-encoded instances", async () => {
              const ctx = new Context();

              class State extends Schema {
                @type("number", ctx) num = 1;
              }

              class Message extends Schema {
                @type("string", ctx) str: string = "Hello world";
              }

              let onMessageCalled = false;

              matchMaker.defineRoomType('sendschema', class _ extends Room {
                onCreate() {
                  this.setState(new State());
                }
                onMessage(client, message) {
                  const msg = new Message();
                  msg.str = message;
                  this.send(client, msg);
                }
              });

              const connection = await client.joinOrCreate('sendschema', {}, State);
              let messageReceived: Message;

              connection.onMessage((message) => {
                onMessageCalled = true;
                messageReceived = message;
              });
              connection.send("hello!");
              await timeout(100);

              await connection.leave();

              assert.ok(onMessageCalled);
              assert.equal(messageReceived.str, "hello!");
            });
          });

          describe("lock / unlock", () => {
            before(() => {
              server.define("room2", Room2Clients);
              server.define("room_explicit_lock", Room2ClientsExplicitLock);
            });

            it("should lock room automatically when maxClients is reached", async () => {
              const conn1 = await client.joinOrCreate('room2');

              const room = matchMaker.getRoomById(conn1.id);
              assert.equal(false, room.locked);

              const conn2 = await client.joinOrCreate('room2');

              assert.equal(2, room.clients.length);
              assert.equal(true, room.locked);

              const roomListing = (await matchMaker.query({}))[0];
              assert.equal(true, roomListing.locked);

              conn1.leave();
              conn2.leave();

              await timeout(100);
            });

            it("should unlock room automatically when last client leaves", async () => {
              const conn1 = await client.joinOrCreate('room2');
              const conn2 = await client.joinOrCreate('room2');

              const room = matchMaker.getRoomById(conn1.id);
              assert.equal(2, room.clients.length);
              assert.equal(true, room.locked);

              conn2.leave();
              await timeout(50);

              assert.equal(1, room.clients.length);
              assert.equal(false, room.locked);

              const roomListing = (await matchMaker.query({ name: "room2" }))[0];
              assert.equal(false, roomListing.locked);

              conn1.leave();
            });

            it("when explicitly locked, should remain locked when last client leaves", async () => {
              const conn1 = await client.joinOrCreate('room_explicit_lock');
              const conn2 = await client.joinOrCreate('room_explicit_lock');

              const room = matchMaker.getRoomById(conn1.id);
              assert.equal(2, room.clients.length);
              assert.equal(true, room.locked);

              conn1.send("lock"); // send explicit lock to handler
              await timeout(50);

              assert.equal(true, room.locked);

              conn2.leave();
              await timeout(50);

              assert.equal(1, room.clients.length);
              assert.equal(true, room.locked);

              const roomListing = (await matchMaker.query({}))[0];
              assert.equal(true, roomListing.locked);

              conn1.leave();
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

              await timeout(150);
              assert.equal(2, disconnected, "both clients should've been disconnected");
            });

          });

          describe("Seat reservation", () => {
            it("should not exceed maxClients", async() => {
              // make sure "presence" entry doesn't exist before first client.
              await presence.hdel("created", "single3");

              matchMaker.defineRoomType("single3", class _ extends Room {
                maxClients = 3;
                async onCreate() {
                  const hasRoom = await presence.hget("created", "single3");
                  if (hasRoom) {
                    throw new MatchMakeError("only_one_room_of_this_type_allowed");
                  } else {
                    await this.presence.hset("created", "single3", "1");
                  }
                }
                onMessage() {}
              });

              let connections: Colyseus.Room[] = [];

              const promises = [
                client.joinOrCreate("single3").then(conn => connections.push(conn)),
                client.joinOrCreate("single3").then(conn => connections.push(conn)),
                client.joinOrCreate("single3").then(conn => connections.push(conn)),
                client.joinOrCreate("single3").then(conn => connections.push(conn)),
                client.joinOrCreate("single3").then(conn => connections.push(conn)),
                client.joinOrCreate("single3").then(conn => connections.push(conn)),
                client.joinOrCreate("single3").then(conn => connections.push(conn)),
                client.joinOrCreate("single3").then(conn => connections.push(conn)),
                client.joinOrCreate("single3").then(conn => connections.push(conn)),
              ];

              try {
                await Promise.all(promises);

              } catch (e) {
                // console.log(e);
              }

              await timeout(1000);

              const rooms = await matchMaker.query({ name: "single3" });
              const room = rooms[0];

              assert.equal(3, connections.length);
              assert.deepEqual([room.roomId, room.roomId, room.roomId], connections.map(conn => conn.id));

              assert.equal(1, rooms.length);
              assert.equal(room.roomId, rooms[0].roomId);
            });

            it("consumeSeatReservation()", async () => {
              const seatReservation = await matchMaker.create("dummy", {});
              const conn = await client.consumeSeatReservation(seatReservation);
              assert.equal(conn.id, seatReservation.room.roomId);
              conn.leave();
            })
          });

          describe("`pingTimeout` / `pingMaxRetries`", () => {
            it("should terminate unresponsive client after connection is ready", async () => {
              const conn = await client.joinOrCreate("dummy");

              // force websocket client to be unresponsive
              conn.connection.ws._socket.removeAllListeners();

              assert.ok(matchMaker.getRoomById(conn.id));

              await timeout(700);

              assert.ok(!matchMaker.getRoomById(conn.id));
            });

            it("should remove the room if seat reservation is never fulfiled", async () => {
              const stub = sinon.stub(client, 'consumeSeatReservation').callsFake(function(response) {
                return response;
              });

              const seatReservation = await (client as any).createMatchMakeRequest('joinOrCreate', "dummy", {});
              await (client as any).createMatchMakeRequest('joinOrCreate', "dummy", {});

              assert.ok(matchMaker.getRoomById(seatReservation.room.roomId));

              await timeout(500);

              assert.ok(!matchMaker.getRoomById(seatReservation.room.roomId));

              stub.restore();
            });

          })


        });

      });

    }
  }
});
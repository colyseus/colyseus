import assert from "assert";
import sinon from "sinon";
import * as Colyseus from "colyseus.js";
import { Schema, type, Context } from "@colyseus/schema";

import { matchMaker, Room, Client, Server, ErrorCode } from "../src";
import { DummyRoom, DRIVERS, timeout, Room3Clients, PRESENCE_IMPLEMENTATIONS, Room2Clients, Room2ClientsExplicitLock } from "./utils";
import { ServerError } from "../src/errors/ServerError";

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

        after(() => server.gracefullyShutdown(false));

        describe("Room lifecycle", () => {

          describe("onCreate()", () => {
            it("sync onCreate()", async () => {
              let onCreateCalled = false;

              matchMaker.defineRoomType('oncreate', class _ extends Room {
                onCreate(options) {
                  assert.deepEqual({ string: "hello", number: 1 }, options);
                  onCreateCalled = true;
                }
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
              });

              const connection = await client.joinOrCreate('onjoin');
              await timeout(50);
              assert.ok(onJoinCalled);

              await connection.leave();
            });

            it("error during onJoin should reject client-side promise", async () => {
              matchMaker.defineRoomType('onjoin', class _ extends Room {
                async onJoin(client: Client, options: any) {
                  throw new Error("not_allowed");
                }
              });

              await assert.rejects(async () => await client.joinOrCreate('onjoin'));
            });

            it("should discard connections when early disconnected", async () => {
              matchMaker.defineRoomType('onjoin', class _ extends Room {
                async onJoin(client: Client, options: any) {
                  return new Promise((resolve) => setTimeout(resolve, 100));
                }
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
                throw new Error("not_allowed");
              }
            });

            await assert.rejects(async () => await client.joinOrCreate('onauth'));
          });

          it("onLeave()", async () => {
            let onLeaveCalled = false;

            matchMaker.defineRoomType('onleave', class _ extends Room {
              onLeave(client: Client, options: any) {
                onLeaveCalled = true;
              }
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
            });

            const connection = await client.joinOrCreate('onleave');
            await connection.leave();

            await timeout(150);
            assert.ok(!matchMaker.getRoomById(connection.id))
            assert.ok(onDisposeCalled);
          });

          describe("onMessage()", () => {
            it("should support string key as message type", async () => {
              const messageToSend = {
                string: "hello",
                number: 10,
                float: Math.PI,
                array: [1, 2, 3, 4, 5],
                nested: {
                  string: "hello",
                  number: 10,
                  float: Math.PI,
                }
              };

              let onMessageCalled = false;
              let sessionId: string;

              matchMaker.defineRoomType('onmessage', class _ extends Room {
                onCreate() {
                  this.onMessage("msgtype", (client, message) => {
                    sessionId = client.sessionId;
                    assert.deepEqual(messageToSend, message);
                    onMessageCalled = true;
                  });
                }
              });

              const connection = await client.joinOrCreate('onmessage');
              connection.send("msgtype", messageToSend);
              await timeout(20);

              await connection.leave();

              assert.equal(sessionId, connection.sessionId);
              assert.ok(onMessageCalled);
            });

            it("should support number key as message type", async () => {
              enum MessageTypes { REQUEST, RESPONSE }

              const messageToSend = {
                string: "hello",
                number: 10,
                float: Math.PI,
                array: [1, 2, 3, 4, 5],
                nested: {
                  string: "hello",
                  number: 10,
                  float: Math.PI,
                }
              };

              let onMessageCalled = false;
              let onMessageReceived = false;
              let sessionId: string;

              matchMaker.defineRoomType('onmessage', class _ extends Room {
                onCreate() {
                  this.onMessage(MessageTypes.REQUEST, (client, message) => {
                    sessionId = client.sessionId;
                    client.send(MessageTypes.RESPONSE, message);
                    assert.deepEqual(messageToSend, message);
                    onMessageCalled = true;
                  });
                }
              });

              const connection = await client.joinOrCreate('onmessage');
              connection.send(MessageTypes.REQUEST, messageToSend);

              connection.onMessage(MessageTypes.RESPONSE, (message) => {
                assert.deepEqual(messageToSend, message);
                onMessageReceived = true;
              });

              await timeout(20);
              await connection.leave();

              assert.equal(sessionId, connection.sessionId);
              assert.ok(onMessageCalled);
              assert.ok(onMessageReceived);
            });

            it("should support send/receive messages by type without payload.", async () => {
              let onMessageCalled = false;
              let onMessageReceived = false;
              let sessionId: string;

              matchMaker.defineRoomType('onmessage', class _ extends Room {
                onCreate() {
                  this.onMessage(1, (client) => {
                    sessionId = client.sessionId;
                    onMessageCalled = true;
                    client.send("response");
                  });
                }
              });

              const connection = await client.joinOrCreate('onmessage');
              connection.send(1);

              connection.onMessage("response", (message) => {
                assert.ok(message === undefined);
                onMessageReceived = true;
              });

              await timeout(20);
              await connection.leave();

              assert.equal(sessionId, connection.sessionId);
              assert.ok(onMessageCalled);
              assert.ok(onMessageReceived);
            });
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

                onCreate() {
                  this.onMessage("*", (_, type, message) => {
                    this.broadcast(type, message);
                  })
                }
              });

              const messages: string[] = [];

              const conn1 = await client.joinOrCreate('broadcast');
              conn1.onMessage("num", message => messages.push(message));

              const conn2 = await client.joinOrCreate('broadcast');
              conn2.onMessage("num", message => messages.push(message));

              const conn3 = await client.joinOrCreate('broadcast');
              conn3.onMessage("num", message => messages.push(message));

              conn1.send("num", "one");
              conn2.send("num", "two");
              conn3.send("num", "three");

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

                onCreate() {
                  this.onMessage("*", (client, type, message) => {
                    this.broadcast(type, message, { except: client });
                  })
                }
              });

              const messages: string[] = [];

              const conn1 = await client.joinOrCreate('broadcast');
              conn1.onMessage("num", message => messages.push(message));

              const conn2 = await client.joinOrCreate('broadcast');
              conn2.onMessage("num", message => messages.push(message));

              const conn3 = await client.joinOrCreate('broadcast');
              conn3.onMessage("num", message => messages.push(message));

              conn1.send("num", "one");
              conn2.send("num", "two");
              conn3.send("num", "three");

              await timeout(200);

              assert.deepEqual(["one", "one", "three", "three", "two", "two"], messages.sort());

              conn1.leave();
              conn2.leave();
              conn3.leave();
              await timeout(50);
            });

            it("should allow to send/broadcast during onJoin() for current client", async () => {
              matchMaker.defineRoomType('broadcast', class _ extends Room {
                onJoin(client, options) {
                  client.send("send", "hello");
                  this.broadcast("broadcast", "hello");
                }
              });

              const conn = await client.joinOrCreate('broadcast');

              let onMessageCalled = false;
              let broadcastedMessage: any;
              let sentMessage: any;

              conn.onMessage("broadcast", (_message) => {
                onMessageCalled = true;
                broadcastedMessage = _message;
              });

              conn.onMessage("send", (_message) => {
                onMessageCalled = true;
                sentMessage = _message;
              });

              await timeout(300);

              assert.equal(true, onMessageCalled);
              assert.equal("hello", broadcastedMessage);
              assert.equal("hello", sentMessage);

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
                  this.broadcast("startup", "hello", { afterNextPatch: true });
                  this.state.number = 1;
                }
              });

              const conn = await client.joinOrCreate('broadcast_afterpatch');

              let onMessageCalled = false;
              let message: any;

              conn.onMessage("startup", (_message) => {
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

                  this.onMessage("ping", (client, message) => {
                    const msg = new Message();
                    msg.str = message;
                    client.send(msg);
                  });

                }
              });

              const connection = await client.joinOrCreate('sendschema', {}, State);
              let messageReceived: Message;

              connection.onMessage(Message, (message) => {
                onMessageCalled = true;
                messageReceived = message;
              });
              connection.send("ping", "hello!");
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
                    throw new Error("only_one_room_of_this_type_allowed");
                  } else {
                    await this.presence.hset("created", "single3", "1");
                  }
                }
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

        describe("Error handling", () => {
            it("ErrorCode.MATCHMAKE_NO_HANDLER", async () => {
              try {
                await client.joinOrCreate('nonexisting')
                assert.fail("joinOrCreate should have failed.");

              } catch (e) {
                assert.equal(ErrorCode.MATCHMAKE_NO_HANDLER, e.code)
              }
            });

            it("should have reasonable error message when providing an empty room name", async () => {
              try {
                await client.joinOrCreate('')
                assert.fail("joinOrCreate should have failed.");

              } catch (e) {
                assert.equal(ErrorCode.MATCHMAKE_NO_HANDLER, e.code)
                assert.equal('provided room name "" not defined', e.message);
              }
            });

            it("ErrorCode.AUTH_FAILED", async () => {
              matchMaker.defineRoomType('onAuthFail', class _ extends Room {
                async onAuth(client: Client, options: any) {
                  return false;
                }
              });

              try {
                await client.joinOrCreate('onAuthFail')
                assert.fail("joinOrCreate should have failed.");

              } catch (e) {
                assert.equal(ErrorCode.AUTH_FAILED, e.code)
              }
            });

            it("onAuth: custom error", async () => {
              matchMaker.defineRoomType('onAuthFail', class _ extends Room {
                async onAuth(client: Client, options: any) {
                  throw new ServerError(1, "invalid token");
                }
              });

              try {
                await client.joinOrCreate('onAuthFail')
                assert.fail("joinOrCreate should have failed.");

              } catch (e) {
                assert.equal(1, e.code);
                assert.equal("invalid token", e.message);
              }
            });

            it("onJoin: application error", async () => {
              matchMaker.defineRoomType('onJoinError', class _ extends Room {
                async onJoin(client: Client, options: any) {
                  throw new Error("unexpected error");
                }
              });

              try {
                await client.joinOrCreate('onJoinError')
                assert.fail("joinOrCreate should have failed.");

              } catch (e) {
                assert.equal(ErrorCode.APPLICATION_ERROR, e.code)
                assert.equal("unexpected error", e.message)
              }
            });

            it("onJoin: application error with custom code", async () => {
              matchMaker.defineRoomType('onJoinError', class _ extends Room {
                async onJoin(client: Client, options: any) {
                  throw new ServerError(2, "unexpected error");
                }
              });

              try {
                await client.joinOrCreate('onJoinError')
                assert.fail("joinOrCreate should have failed.");

              } catch (e) {
                assert.equal(2, e.code)
                assert.equal("unexpected error", e.message)
              }
            });
        });


      });

    }
  }
});
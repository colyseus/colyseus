import assert from "assert";
import crypto from "crypto";
import sinon from "sinon";
import { Client as SDKClient, Room as SDKRoom } from "colyseus.js";
import { Schema, type, MapSchema, ArraySchema, view, StateView, schema, type SchemaType } from "@colyseus/schema";

import { type Client, type AuthContext, type MatchMakerDriver, type Presence, matchMaker, Room, Server, ErrorCode,  Deferred, Transport, CloseCode } from "@colyseus/core";
import { DummyRoom, DRIVERS, timeout, Room3Clients, PRESENCE_IMPLEMENTATIONS, Room2Clients, Room2ClientsExplicitLock } from "./utils/index.ts";
import { ServerError, Protocol } from "@colyseus/core";

import { WebSocketTransport } from "@colyseus/ws-transport";

import WebSocket from "ws";
import { z } from "zod";

const TEST_PORT = 8567;
const TEST_ENDPOINT = `ws://localhost:${TEST_PORT}`;

const MAX_PAYLOAD = 1024 * 16;

describe("Integration", () => {
  for (let i = 0; i < PRESENCE_IMPLEMENTATIONS.length; i++) {
    for (let j = 0; j < DRIVERS.length; j++) {
      describe(`Driver => ${DRIVERS[j].name}, Presence => ${PRESENCE_IMPLEMENTATIONS[i].name}`, () => {
        let driver: MatchMakerDriver;
        let server: Server;
        let presence: Presence;
        let transport: Transport;

        const client = new SDKClient(TEST_ENDPOINT);

        before(async () => {
          driver = new DRIVERS[j]();
          presence = new PRESENCE_IMPLEMENTATIONS[i]();
          transport = new WebSocketTransport({
            pingInterval: 100,
            pingMaxRetries: 3,
            maxPayload: MAX_PAYLOAD
          });

          server = new Server({
            greet: false,
            gracefullyShutdown: false,
            presence,
            driver,
            transport,
          });

          // setup matchmaker
          await matchMaker.setup(presence, driver);

          // define a room
          server.define("dummy", DummyRoom);
          server.define("room3", Room3Clients);

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

        describe("Room lifecycle", () => {

          describe("onCreate()", () => {
            it("sync onCreate()", async () => {
              let onCreateCalled = false;

              matchMaker.defineRoomType('oncreate', class _ extends Room {
                onCreate(options) {
                  assert.deepStrictEqual({ string: "hello", number: 1 }, options);
                  onCreateCalled = true;
                }
              });

              const connection = await client.joinOrCreate('oncreate', { string: "hello", number: 1 });
              assert.strictEqual(true, onCreateCalled);

              await connection.leave();
            });

            it("async onCreate()", async () => {
              let onCreateCalled = false;

              matchMaker.defineRoomType('oncreate', class _ extends Room {
                async onCreate(options) {
                  return new Promise<void>(resolve => setTimeout(() => {
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
                  assert.deepStrictEqual({ string: "hello", number: 1 }, options);
                }
              });

              const connection = await client.joinOrCreate('onjoin', { string: "hello", number: 1 });
              assert.ok(onJoinCalled);

              await connection.leave();
            });

            it("concurrent sync onJoin(), maxClients = 2", async () => {
              const onJoinHit = new Deferred<string>();
              matchMaker.defineRoomType("room2_async", class _ extends Room {
                maxClients = 2;
                async onJoin() {
                  onJoinHit.resolve();
                  await new Promise(resolve => setTimeout(resolve, 100));
                }
              });

              const room = await matchMaker.createRoom("room2_async", {});

              client.joinById(room.roomId);
              await onJoinHit;

              await client.joinById(room.roomId);
              assert.strictEqual(2, matchMaker.getLocalRoomById(room.roomId).clients.length);

              // disconnect room
              await matchMaker.getLocalRoomById(room.roomId).disconnect();
            });

            it("async onJoin support", async () => {
              let onJoinCalled = false;

              matchMaker.defineRoomType('onjoin', class _ extends Room {
                async onJoin(client: Client, options: any) {
                  return new Promise<void>(resolve => setTimeout(() => {
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
                  return new Promise<void>((resolve) => setTimeout(resolve, 100));
                }
              });

              // keep one active connection to prevent room's disposal
              const activeConnection = await client.joinOrCreate("onjoin");

              const seatReservation = await matchMaker.joinOrCreate('onjoin', {});
              const room = matchMaker.getLocalRoomById(seatReservation.room.roomId);

              const lostConnection = new WebSocket(`${TEST_ENDPOINT}/${seatReservation.room.processId}/${seatReservation.room.roomId}?sessionId=${seatReservation.sessionId}`);

              // close connection immediatelly after connecting.
              lostConnection.on("open", () => lostConnection.close());

              await timeout(110);

              const rooms = await matchMaker.query({ name: "onjoin" });

              assert.strictEqual(1, room.clients.length);
              assert.strictEqual(1, rooms[0].clients);

              await activeConnection.leave();
              await timeout(50);
            });

            it("server should deny sending acknowledgement packet twice", async () => {
              matchMaker.defineRoomType('onjoin_ack_twice', class _ extends Room {});

              const room = await client.joinOrCreate('onjoin_ack_twice');
              room.connection.send(Buffer.from([Protocol.JOIN_ROOM]));

              await timeout(50);
              assert.ok(true);
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

          it("onAuth() getting IP address", async() => {
            matchMaker.defineRoomType('onauth_ip_address', class _ extends Room {
              async onAuth(client: Client, options: any, context: AuthContext) {
                const ipAddress = context.ip;
                client.send("ip", ipAddress);
                return true;
              }
            });

            const connection = await client.joinOrCreate('onauth_ip_address');

            await new Promise<void>((resolve, reject) => {
              const rejectionTimeout = setTimeout(reject, 200);
              connection.onMessage("ip", (address) => {
                clearInterval(rejectionTimeout);
                assert.ok(typeof(address) === "string");
                resolve();
              });
            });
          });

          it("async onAuth() - should not call onJoin if client left early", async() => {
            let onJoinCalled = false;
            let onLeaveCalled = false;
            let onAuthDeferred = new Deferred();

            matchMaker.defineRoomType('async_onauth', class _ extends Room {
              async onAuth() {
                setTimeout(() => { onAuthDeferred.resolve(true); }, 100);
                return onAuthDeferred;
              }
              onJoin() { onJoinCalled = true; }
              onLeave() { onLeaveCalled = true; }
            });

            // Quickly close WebSocket connetion before onAuth completes
            const seatReservation = await matchMaker.joinOrCreate('async_onauth', {});
            const lostConnection = new WebSocket(`${TEST_ENDPOINT}/${seatReservation.room.processId}/${seatReservation.room.roomId}?sessionId=${seatReservation.sessionId}`);
            lostConnection.on("open", () => lostConnection.close());

            await onAuthDeferred;
            assert.ok(!onJoinCalled);
            assert.ok(!onLeaveCalled);
          });

          it("async onAuth() - maxClients should be respected", async() => {
            let roomId: string;
            let roomsCreated = 0;

            matchMaker.defineRoomType('async_onauth_maxclients', class _ extends Room {
              maxClients = 2;
              onCreate() {
                roomsCreated++;
                roomId = this.roomId;
              }
              onAuth() {
                return new Promise<boolean>((resolve) => {
                  setTimeout(() => resolve(true), 500);
                });
              }
              onJoin() {}
              onLeave() {}
            });

            await Promise.allSettled([
              client.joinOrCreate('async_onauth_maxclients', {}),
              client.joinOrCreate('async_onauth_maxclients', {}),
              client.joinOrCreate('async_onauth_maxclients', {}),
              client.joinOrCreate('async_onauth_maxclients', {}),
            ]);

            const room = matchMaker.getLocalRoomById(roomId);
            assert.strictEqual(2, room.clients.length);
            assert.strictEqual(2, roomsCreated);
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

          it("client.leave() should support custom close code from the server", async () => {
            const customCode = 4040;
            matchMaker.defineRoomType('onleave_customcode', class _ extends Room {
              onJoin(client: Client, options: any) {
                setTimeout(() => client.leave(customCode), 10);
              }
            });

            const connection = await client.joinOrCreate('onleave_customcode');

            await new Promise<void>((resolve, reject) => {
              let rejectTimeout = setTimeout(reject, 1000);
              connection.onLeave((code) => {
                clearTimeout(rejectTimeout);

                assert.strictEqual(customCode, code);
                resolve();
              });
            });
          });

          it("async onLeave()", async () => {
            let onLeaveCalled = false;

            matchMaker.defineRoomType('onleave', class _ extends Room {
              async onLeave(client: Client, options: any) {
                return new Promise<void>(resolve => setTimeout(() => {
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
            assert.ok(!matchMaker.getLocalRoomById(connection.roomId))
            assert.ok(onDisposeCalled);
          });

          it("async onDispose()", async () => {
            let onDisposeCalled = false;

            matchMaker.defineRoomType('onleave', class _ extends Room {
              async onDispose() {
                return new Promise<void>(resolve => setTimeout(() => {
                  onDisposeCalled = true;
                  resolve();
                }, 100));
              }
            });

            const connection = await client.joinOrCreate('onleave');
            await connection.leave();

            await timeout(150);
            assert.ok(!matchMaker.getLocalRoomById(connection.roomId))
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
                    assert.deepStrictEqual(messageToSend, message);
                    onMessageCalled = true;
                  });
                }
              });

              const connection = await client.joinOrCreate('onmessage');
              connection.send("msgtype", messageToSend);
              await timeout(20);

              await connection.leave();

              assert.strictEqual(sessionId, connection.sessionId);
              assert.ok(onMessageCalled);
            });

            it("should support number key as message type", async () => {
              const MessageTypes = { REQUEST: 0, RESPONSE: 1 };

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
                    assert.deepStrictEqual(messageToSend, message);
                    onMessageCalled = true;
                  });
                }
              });

              const connection = await client.joinOrCreate('onmessage');
              connection.send(MessageTypes.REQUEST, messageToSend);

              connection.onMessage(MessageTypes.RESPONSE, (message) => {
                assert.deepStrictEqual(messageToSend, message);
                onMessageReceived = true;
              });

              await timeout(20);
              await connection.leave();

              assert.strictEqual(sessionId, connection.sessionId);
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

              assert.strictEqual(sessionId, connection.sessionId);
              assert.ok(onMessageCalled);
              assert.ok(onMessageReceived);
            });

            it("should support sending and receiving raw bytes", async () => {
              const pingBytes = new Uint8Array([1, 2, 3, 4, 5]);

              matchMaker.defineRoomType('onmessage_bytes', class _ extends Room {
                onCreate() {
                  this.onMessageBytes("bytes", (client, payload) => {
                    client.sendBytes("bytes", payload);
                  });
                }
              });

              const connection = await client.joinOrCreate('onmessage_bytes');

              let receivedBytes: Buffer;
              connection.onMessage("bytes", (pongBytes) => { receivedBytes = pongBytes; });

              connection.sendBytes("bytes", pingBytes);

              await timeout(20);
              await connection.leave();

              assert.deepStrictEqual(Array.from(pingBytes), Array.from(new Uint8Array(receivedBytes)));
            });

            it("should support sending and receiving raw bytes with big payload", async () => {
              const bigBlob = new Blob([crypto.randomBytes(1024 * 9) as any], { type: "audio/webm" });
              const bigPayload = await bigBlob.bytes();

              let serverReceivedPayload: any;
              matchMaker.defineRoomType('onmessage_bytes', class _ extends Room {
                onCreate() {
                  this.onMessageBytes("big-payload", (client, payload) => {
                    serverReceivedPayload = payload;
                    client.sendBytes("big-payload", payload);
                  });
                }
              });

              const connection = await client.joinOrCreate('onmessage_bytes');

              let receivedBytes: Buffer;
              connection.onMessage("big-payload", (pongBytes) => { receivedBytes = pongBytes; });

              connection.sendBytes("big-payload", bigPayload);

              await timeout(20);
              await connection.leave();

              assert.deepStrictEqual(bigPayload, receivedBytes);
              assert.deepStrictEqual(new Uint8Array(serverReceivedPayload), receivedBytes);
            });

            it("should validate input message", async () => {
              const validationSchema = z.object({
                x: z.number(),
                y: z.number(),
              });

              matchMaker.defineRoomType('onmessage_validation', class _ extends Room {
                onCreate() {
                  this.onMessage("input_xy", validationSchema, (client, payload) => {
                    client.send("input_xy", payload);
                  });
                }
              });

              const conn = await client.joinOrCreate('onmessage_validation');

              let receivedMessage: any;
              conn.onMessage("input_xy", (message) => receivedMessage = message);
              conn.send("input_xy", { x: 1, y: 2, z: 3 });
              await timeout(20);

              assert.deepStrictEqual(receivedMessage, { x: 1, y: 2 });
            });

            xit("should disconnect if input validation throws", async () => {
              //
              // TODO:
              // - add more tests for message validation errors
              // - previous iteration of colyseus allowed to provide arbitrary function to validate and allowed to throw inside it. This is no longer allowed.
              // - add more tests for throwing inside onMessage.
              //

              matchMaker.defineRoomType('onmessage_validation', class _ extends Room {
                onCreate() {
                  this.onMessage("input_xy", z.object({ x: z.number(), y: z.number() }), (_) => {
                    throw new Error("what");
                  });
                }
              });

              const conn = await client.joinOrCreate('onmessage_validation');

              let onLeaveCode: number;
              conn.onLeave((code) => onLeaveCode = code);

              conn.send("input_xy", { x: 1, y: 2, z: 3 });
              await timeout(20);

              assert.strictEqual(onLeaveCode, CloseCode.WITH_ERROR);
            });

          });

          describe("patchRate", () => {
            const PatchState = schema({
              number: { type: "number", default: 0 },
            });
            type PatchState = SchemaType<typeof PatchState>;

            it("should receive patch at every patch rate", async () => {
              matchMaker.defineRoomType('patchinterval', class _ extends Room {
                state = new PatchState();
                patchRate = 20;
                onCreate(options: any) {
                  this.setSimulationInterval(() => this.state.number++);
                }
              });

              const connection = await client.create<PatchState>('patchinterval');
              let patchesReceived: number = 0;

              connection.onStateChange(() => patchesReceived++);

              await timeout(20 * 25);
              assert.ok(patchesReceived > 20, "should have received > 20 patches. got " + patchesReceived);
              assert.ok(connection.state.number >= 20);

              connection.leave();
              await timeout(50);
            });

            it("should not receive any patch if patchRate is nullified", async () => {
              matchMaker.defineRoomType('patchinterval', class _ extends Room {
                patchRate = null;
                state = new PatchState();
                onCreate(options: any) {
                  this.setSimulationInterval(() => this.state.number++);
                }
              });

              const connection = await client.create<PatchState>('patchinterval');
              let stateChangeCount: number = 0;

              connection.onStateChange(() => stateChangeCount++);

              await timeout(500);

              // simulation interval may have run a short amount of cycles for the first ROOM_STATE message
              assert.strictEqual(1, stateChangeCount);

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

              assert.deepStrictEqual(["one", "one", "one", "three", "three", "three", "two", "two", "two"], messages.sort());

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
                  });
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

              assert.deepStrictEqual(["one", "one", "three", "three", "two", "two"], messages.sort());

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

              assert.strictEqual(true, onMessageCalled);
              assert.strictEqual("hello", broadcastedMessage);
              assert.strictEqual("hello", sentMessage);

              conn.leave();
            });

            it("should broadcast after patch", async () => {
              const DummyState = schema({
                number: { type: "number", default: 0 },
              });
              type DummyState = SchemaType<typeof DummyState>;

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

              assert.strictEqual(false, onMessageCalled);

              await timeout(100);

              assert.strictEqual(true, onMessageCalled);
              assert.strictEqual("hello", message);

              conn.leave();
            });

          });

          describe("send()", () => {

            it("should send after patch", async () => {
              const DummyState = schema({
                number: { type: "number", default: 0 },
              });
              type DummyState = SchemaType<typeof DummyState>;

              matchMaker.defineRoomType('send_afterpatch', class _ extends Room {
                onCreate() {
                  this.setPatchRate(100);
                  this.setState(new DummyState);
                }
                onJoin(client: Client, options) {
                  client.send("startup", "hello", { afterNextPatch: true });
                  this.state.number = 1;
                }
              });

              const conn = await client.joinOrCreate('send_afterpatch');

              let onMessageCalled = false;
              let message: any;

              conn.onMessage("startup", (_message) => {
                onMessageCalled = true;
                message = _message;
              });

              await timeout(50);

              assert.strictEqual(false, onMessageCalled);

              await timeout(100);

              assert.strictEqual(true, onMessageCalled);
              assert.strictEqual("hello", message);

              conn.leave();
            });
          });

          describe("lock / unlock", () => {
            before(() => {
              server.define("room2", Room2Clients);
              server.define("room_explicit_lock", Room2ClientsExplicitLock);
            });

            it("should lock room automatically when maxClients is reached", async () => {
              const conn1 = await client.joinOrCreate('room2');

              const room = matchMaker.getLocalRoomById(conn1.roomId);
              assert.strictEqual(false, room.locked);

              const conn2 = await client.joinOrCreate('room2');

              assert.strictEqual(2, room.clients.length);
              assert.strictEqual(true, room.locked);

              const roomListing = (await matchMaker.query({ name: "room2" }));
              assert.strictEqual(true, roomListing[0].locked);

              conn1.leave();
              conn2.leave();

              await timeout(100);
            });

            it("should unlock room automatically when last client leaves", async () => {
              const conn1 = await client.joinOrCreate('room2');
              const conn2 = await client.joinOrCreate('room2');

              const room = matchMaker.getLocalRoomById(conn1.roomId);
              assert.strictEqual(2, room.clients.length);
              assert.strictEqual(true, room.locked);

              conn2.leave();
              await timeout(50);

              assert.strictEqual(1, room.clients.length);
              assert.strictEqual(false, room.locked);

              const roomListing = (await matchMaker.query({ name: "room2" }))[0];
              assert.strictEqual(false, roomListing.locked);

              conn1.leave();
            });

            it("when explicitly locked, should remain locked when last client leaves", async () => {
              const conn1 = await client.joinOrCreate('room_explicit_lock');
              const conn2 = await client.joinOrCreate('room_explicit_lock');

              const room = matchMaker.getLocalRoomById(conn1.roomId);
              assert.strictEqual(2, room.clients.length);
              assert.strictEqual(true, room.locked);

              conn1.send("lock"); // send explicit lock to handler
              await timeout(50);

              assert.strictEqual(true, room.locked);

              conn2.leave();
              await timeout(50);

              assert.strictEqual(1, room.clients.length);
              assert.strictEqual(true, room.locked);

              const roomListing = (await matchMaker.query({}))[0];
              assert.strictEqual(true, roomListing.locked);

              conn1.leave();
            });

          });

          describe("disconnect()", () => {
            it("should remove room reference", async () => {
              let roomId: string;
              const clients: Client[] = [];
              matchMaker.defineRoomType('disconnect', class _ extends Room {
                maxClients = 2;
                onCreate() { roomId = this.roomId; }
                onJoin(client) { clients.push(client); }
                async onLeave() { await timeout(5); }
              });

              const promises = [
                client.joinOrCreate('disconnect'),
                client.joinOrCreate('disconnect'),
              ];

              await Promise.all(promises);

              const room = matchMaker.getLocalRoomById(roomId);
              assert.strictEqual(room.roomId, roomId);

              await room.disconnect();
              await timeout(10);

              assert.ok(!matchMaker.getLocalRoomById(roomId));
            });

            it("second .disconnect() call should return a resolved promise", async () => {
              let roomId: string;
              const clients: Client[] = [];
              matchMaker.defineRoomType('disconnect', class _ extends Room {
                maxClients = 2;
                onCreate() { roomId = this.roomId; }
                onJoin(client) { clients.push(client); }
                async onLeave() { await timeout(20); }
              });

              const promises = [
                client.joinOrCreate('disconnect'),
                client.joinOrCreate('disconnect'),
              ];

              await Promise.all(promises);

              const room = matchMaker.getLocalRoomById(roomId);
              assert.strictEqual(room.roomId, roomId);

              room.disconnect();

              assert.rejects(async () => {
                await room.disconnect();
              })
            });

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

              assert.strictEqual(conn1.roomId, conn2.roomId, "should've joined the same room");

              await timeout(150);
              assert.strictEqual(2, disconnected, "both clients should've been disconnected");
            });

            it("disconnect during onCreate is not allowed", async() => {
              let onCreateResolved = false;
              let onJoinResolved = false;

              matchMaker.defineRoomType('disconnect_oncreate', class _ extends Room {
                onCreate() {
                  this.disconnect();
                  onCreateResolved = true;
                }
              });

              assert.rejects(async () => {
                await client.joinOrCreate('disconnect_oncreate');
                onJoinResolved = true;
              }, { message: "cannot disconnect during onCreate()" });

              await timeout(50);

              assert.strictEqual(false, onCreateResolved);
              assert.strictEqual(false, onJoinResolved);
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

              let connections: SDKRoom[] = [];

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

              assert.strictEqual(3, connections.length);
              assert.deepStrictEqual([room.roomId, room.roomId, room.roomId], connections.map(conn => conn.roomId));

              assert.strictEqual(1, rooms.length);
              assert.strictEqual(room.roomId, rooms[0].roomId);
            });

            it("consumeSeatReservation()", async () => {
              const seatReservation = await matchMaker.create("dummy", {});
              const conn = await client.consumeSeatReservation(seatReservation);
              assert.strictEqual(conn.roomId, seatReservation.room.roomId);
              conn.leave();
            })
          });

          describe("`pingTimeout` / `pingMaxRetries`", () => {
            // this test stopped working since ws upgrade to ws@8.x
            xit("should terminate unresponsive client after connection is ready", async () => {
              // if (server.transport instanceof uWebSocketsTransport) {
              //   console.warn("WARNING: this test is being skipped. (not supported in uWebSocketsTransport)");
              //   assert.ok(true);
              //   return;
              // }

              const roomClient = await client.joinOrCreate("dummy");

              //
              // force websocket client to be unresponsive
              //
              // FIXME:
              //    since Node.js v22, it's not possible to force a client to be unresponsive.
              //    the built-in WebSocket implementation is being used instead of ws@8
              //
              (roomClient.connection.transport as any).ws._socket.removeAllListeners();

              assert.ok(matchMaker.getLocalRoomById(roomClient.roomId));

              await timeout(700);

              assert.strictEqual(undefined, matchMaker.getLocalRoomById(roomClient.roomId));
            });

            it("should remove the room if seat reservation is never fulfiled", async () => {
              // @ts-ignore
              const stub = sinon.stub(client, 'consumeSeatReservation').callsFake((response) => response);

              const seatReservation = await (client as any).createMatchMakeRequest('joinOrCreate', "dummy", {});
              await client['createMatchMakeRequest']('joinOrCreate', "dummy", {});

              assert.ok(matchMaker.getLocalRoomById(seatReservation.room.roomId));

              await timeout(500);

              assert.ok(!matchMaker.getLocalRoomById(seatReservation.room.roomId));

              stub.restore();
            });

          })

          describe("onLeave with exceptions", () => {
            it("should trigger onLeave if onJoin fails", async () => {
              const Player = schema({
                name: { type: "string" },
              });
              type Player = SchemaType<typeof Player>;

              const MyState = schema({
                players: { map: Player },
              });
              type MyState = SchemaType<typeof MyState>;

              let room: Room<typeof MyState>;
              matchMaker.defineRoomType("onJoinFail", class _ extends Room<typeof MyState> {
                onCreate() {
                  room = this;
                  this.autoDispose = false;
                  this.setState(new MyState());
                }
                onJoin(client) {
                  this.state.players.set(client.sessionId, new Player().assign({ name: "Player" + this.clients.length + 1 }));
                  throw new Error("onJoin failed");
                }
                onLeave(client, _) {
                  this.state.players.delete(client.sessionId);
                }
              });

              try {
                const _ = await client.joinOrCreate("onJoinFail");
              } catch (e) {}
              try {
                const _ = await client.joinOrCreate("onJoinFail");
              } catch (e) {}

              assert.strictEqual(room.state.players.size, 0);
              assert.deepStrictEqual({ roomCount: 1, ccu: 0 }, matchMaker.stats.local);

              await room.disconnect();
            });

          });

          describe("Scoped Presence", () => {
            it("should unsubscribe from all topics when room is disposed", async () => {
              matchMaker.defineRoomType('scoped_presence', class _ extends Room {
                async onCreate(options) {
                  // Subscribe to multiple topics through the scoped presence
                  await this.presence.subscribe("topic1", (data) => {});
                  await this.presence.subscribe("topic2", (data) => {});
                  await this.presence.subscribe("topic3", (data) => {});
                }
              });

              // Create and join the room
              const connection = await client.joinOrCreate('scoped_presence');

              // Give time for subscriptions to be set up
              await timeout(50);

              // Verify subscriptions exist on the underlying presence
              const channels = await presence.channels("*")
              assert.ok(channels.includes("topic1"));
              assert.ok(channels.includes("topic2"));
              assert.ok(channels.includes("topic3"));

              // Disconnect and dispose the room
              await connection.leave();
              await timeout(100);

              // Verify all subscriptions were cleaned up
              const channelsAfter = await presence.channels("*");
              assert.ok(!channelsAfter.includes("topic1"));
              assert.ok(!channelsAfter.includes("topic2"));
              assert.ok(!channelsAfter.includes("topic3"));
            });
          });

        });

        describe("Error handling", () => {
            it("ErrorCode.MATCHMAKE_NO_HANDLER", async () => {
              try {
                await client.joinOrCreate('nonexisting')
                assert.fail("joinOrCreate should have failed.");

              } catch (e) {
                assert.strictEqual(ErrorCode.MATCHMAKE_NO_HANDLER, e.code)
              }
            });

            it("should have reasonable error message when providing an empty room name", async () => {
              try {
                await client.joinOrCreate('')
                assert.fail("joinOrCreate should have failed.");

              } catch (e) {
                assert.strictEqual(404, e.code)
              }
            });

            it("ErrorCode.MATCHMAKE_INVALID_ROOM_ID", async () => {
              try {
                await client.joinById('abcdedfgh')
                assert.fail("joinById with invalid id should fail.");

              } catch (e) {
                assert.strictEqual(ErrorCode.MATCHMAKE_INVALID_ROOM_ID, e.code)
              }
            });

            it("ErrorCode.AUTH_FAILED: instance onAuth", async () => {
              matchMaker.defineRoomType('onAuthFail', class _ extends Room {
                async onAuth(client: Client, options: any) {
                  return false;
                }
              });

              try {
                await client.joinOrCreate('onAuthFail')
                assert.fail("joinOrCreate should have failed.");

              } catch (e) {
                assert.strictEqual(ErrorCode.AUTH_FAILED, e.code)
              }
            });

            it("ErrorCode.AUTH_FAILED: static onAuth", async () => {
              matchMaker.defineRoomType('onAuthFail', class _ extends Room {
                static async onAuth(token: string) {
                  return false;
                }
              });

              try {
                await client.joinOrCreate('onAuthFail')
                assert.fail("joinOrCreate should have failed.");

              } catch (e) {
                assert.strictEqual(ErrorCode.AUTH_FAILED, e.code)
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
                assert.strictEqual(1, e.code);
                assert.strictEqual("invalid token", e.message);
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
                assert.strictEqual(ErrorCode.APPLICATION_ERROR, e.code)
                assert.strictEqual("unexpected error", e.message)
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
                assert.strictEqual(2, e.code)
                assert.strictEqual("unexpected error", e.message)
              }
            });
        });

        describe("early-leave on async onJoin", () => {
          it("onLeave should only be called after onJoin finished", async () => {
            let onLeaveCalled = 0;
            let onJoinCompleted = 0;

            let onJoinStart = new Deferred();
            let onJoinFinished = new Deferred();
            let onLeaveFinished = new Deferred();
            let onRoomDisposed = new Deferred();

            matchMaker.defineRoomType('async_onjoin', class _ extends Room {
              async onAuth() { return true; }
              async onJoin() {
                onJoinStart.resolve(true);
                setTimeout(() => {
                  onJoinCompleted = Date.now();
                  onJoinFinished.resolve(true);
                }, 100);
                return onJoinFinished;
              }
              async onLeave(client) {
                onLeaveCalled = Date.now();
                // if left early - allow reconnection should be no-op
                try {
                  await this.allowReconnection(client, 1);
                } catch (e) {
                  }
              }
              onDispose() { onRoomDisposed.resolve(true); }
            });

            // Close WebSocket connetion before `onJoin` completes
            const seatReservation = await matchMaker.joinOrCreate('async_onjoin', {});
            const lostConnection = new WebSocket(`${TEST_ENDPOINT}/${seatReservation.room.processId}/${seatReservation.room.roomId}?sessionId=${seatReservation.sessionId}`);
            lostConnection.on("open", () => {
              // force disconnect when onJoin starts
              onJoinStart.then(() => lostConnection.close());
            });

            await onRoomDisposed;

            assert.strictEqual(true, onJoinCompleted > 0);
            assert.strictEqual(true, onLeaveCalled > 0);
            assert.strictEqual(true, onLeaveCalled >= onJoinCompleted);

            assert.strictEqual(0, matchMaker.stats.local.roomCount);
            assert.strictEqual(0, matchMaker.stats.local.ccu);
          });

          it("should call onLeave if onJoin fails, even if client disconnect before fully joining", async () => {
            let onLeaveCalled = 0;
            let onJoinCompleted = 0;

            const joinStart = new Deferred();
            const onRoomDisposed = new Deferred();

            matchMaker.defineRoomType('async_onjoin', class _ extends Room {
              async onAuth() { return true; }
              async onJoin() {
                joinStart.resolve(true);
                await new Promise((res, rej) => setTimeout(res, 100));
                onJoinCompleted = Date.now();
                throw new Error('cannot join');
              }
              onLeave() {
                onLeaveCalled = Date.now();
              }
              onDispose() {
                onRoomDisposed.resolve(true);
              }
            });

            const seatReservation = await matchMaker.joinOrCreate('async_onjoin');
            const lostConnection = new WebSocket(`${TEST_ENDPOINT}/${seatReservation.room.processId}/${seatReservation.room.roomId}?sessionId=${seatReservation.sessionId}`);
            lostConnection.on("open", () => {
              // disconnect only after join starts.
              joinStart.then(() => {
                lostConnection.close();
              });
            });

            await new Promise<void>((resolve) => lostConnection.on('close', resolve));
            await timeout(100);

            assert.strictEqual(true, onJoinCompleted > 0);
            assert.strictEqual(true, onLeaveCalled >= onJoinCompleted);

            await onRoomDisposed;

            assert.strictEqual(0, matchMaker.stats.local.roomCount);
            assert.strictEqual(0, matchMaker.stats.local.ccu);

          });

        });

        describe("reconnection", () => {

          it("reconnected client should received messages from previous and new 'client' instance", async () => {
            const onRoomDisposed = new Deferred();
            matchMaker.defineRoomType('allow_reconnection', class _ extends Room {
              async onLeave(client: Client, code: number) {
                try {
                  if (code === CloseCode.CONSENTED) { throw new Error("consented!"); }

                  await this.allowReconnection(client, 0.5);

                  //
                  // TODO: what should happen if sending messages while reconnection is in progress?
                  //

                  // sending message from previous client instance
                  // client.send("reconnected", "previous");

                  // sending message from new client instance
                  this.clients.getById(client.sessionId).send("reconnected", "new");
                } catch (e) {}
              }
              onDispose() { onRoomDisposed.resolve(); }
            });

            const roomConnection = await client.joinOrCreate('allow_reconnection');

            // forcibly close connection
            roomConnection.connection.transport.close();

            // wait for reconnection to timeout
            await timeout(50);
            const reconnectedRoom = await client.reconnect(roomConnection.reconnectionToken);

            let receivedMessages: string[] = [];
            reconnectedRoom.onMessage("reconnected", (value) => receivedMessages.push(value));

            await timeout(200);
            assert.deepStrictEqual(['new'], receivedMessages);
            // assert.deepStrictEqual(['previous', 'new'], receivedMessages);

            await reconnectedRoom.leave();
          });

          it("reconnected client should received messages from previous and new 'client' instance", async () => {
            const reconnectionTokens = [];

            matchMaker.defineRoomType('allow_reconnection', class _ extends Room {
              async onLeave(client: Client, code: CloseCode) {
                try {
                  if (code === CloseCode.CONSENTED) { throw new Error("consented!"); }

                  // reconnectionToken before reconnecting
                  reconnectionTokens.push(client.reconnectionToken);

                  await this.allowReconnection(client, 0.5);

                  // reconnectionToken should be updated with new connection
                  reconnectionTokens.push(client.reconnectionToken);
                } catch (e) {}
              }
            });

            const roomConnection = await client.joinOrCreate('allow_reconnection');

            // forcibly close connection
            roomConnection.connection.transport.close();

            // wait for reconnection to timeout
            await timeout(50);
            const reconnectedRoom = await client.reconnect(roomConnection.reconnectionToken);

            assert.notStrictEqual(reconnectionTokens[0], reconnectionTokens[1]);

            await reconnectedRoom.leave();
          });

          it("should dispose room on allowReconnection timeout", async () => {
            const onRoomDisposed = new Deferred();
            matchMaker.defineRoomType('allow_reconnection', class _ extends Room {
              // async onJoin() {}
              async onLeave(client, code: CloseCode) {
                try {
                  if (code === CloseCode.CONSENTED) {
                    throw new Error("consented!");
                  }
                  await this.allowReconnection(client, 0.1);
                } catch (e) {
                  console.log("not reconnected in time...", e.message);
                }
              }
              onDispose() {
                onRoomDisposed.resolve();
              }
            });

            const roomConnection = await client.joinOrCreate('allow_reconnection');

            assert.strictEqual(1, matchMaker.stats.local.roomCount);
            assert.strictEqual(1, matchMaker.stats.local.ccu);

            // forcibly close connection
            roomConnection.connection.transport.close();

            // wait for reconnection to timeout
            await timeout(150);
            await onRoomDisposed;
            await timeout(10);

            const rooms = await matchMaker.query({});
            assert.strictEqual(0, rooms.length);
            assert.strictEqual(0, matchMaker.stats.local.roomCount);
            assert.strictEqual(0, matchMaker.stats.local.ccu);
          });

          it("should reject reconnection when using .disconnect()", async () => {
            let room: Room;
            let failureError = "";
            let onLeaveCalled = false;
            let onRoomDisposed = false;

            matchMaker.defineRoomType('allow_reconnection', class _ extends Room {
              onCreate() { room = this; }
              async onLeave(client, code: CloseCode) {
                onLeaveCalled = true;
                try {
                  await this.allowReconnection(client, 0.1);
                } catch (e) {
                  failureError = e.message;
                }
              }
              onDispose() { onRoomDisposed = true; }
            });

            const roomConnection = await client.joinOrCreate('allow_reconnection');

            // forcibly close connection
            roomConnection.connection.transport.close();

            // wait for reconnection to timeout
            await timeout(10);
            assert.strictEqual(true, onLeaveCalled);

            await room.disconnect();

            assert.strictEqual(true, onRoomDisposed);
            assert.strictEqual("disconnecting", failureError);
          });

          it("should reject reconnection when already disposing", async () => {
            let room: Room;
            let failureError = "";
            let onLeaveCalled = false;
            let onRoomDisposed = false;

            matchMaker.defineRoomType('allow_reconnection', class _ extends Room {
              onCreate() { room = this; }
              async onLeave(client, code: CloseCode) {
                onLeaveCalled = true;
                await new Promise((resolve) => setTimeout(resolve, 100));
                try {
                  await this.allowReconnection(client, 0.1);
                } catch (e) {
                  failureError = e.message;
                }
              }
              onDispose() { onRoomDisposed = true; }
            });

            const roomConnection = await client.joinOrCreate('allow_reconnection');

            // forcibly close connection
            roomConnection.connection.transport.close();

            // wait for reconnection to timeout
            await timeout(10);
            assert.strictEqual(true, onLeaveCalled);

            await room.disconnect();
            await timeout(100);

            assert.strictEqual(true, onRoomDisposed);
            assert.strictEqual("disposing", failureError);
          });

          it("reconnection with StateView should recreate the StateView", async () => {
            const Item = schema({
              name: { type: "string" },
            });
            type Item = SchemaType<typeof Item>;

            const Entity = schema({
              items: { array: Item },
            });
            type Entity = SchemaType<typeof Entity>;

            const State = schema({
              entities: { map: Entity, view: true },
            });
            type State = SchemaType<typeof State>;

            const onRoomDisposed = new Deferred();
            matchMaker.defineRoomType('reconnect_with_stateview', class _ extends Room {
              state = new State();
              async onJoin(client: Client) {
                const entity = new Entity().assign({
                  items: [
                    new Item().assign({ name: "item1" }),
                    new Item().assign({ name: "item2" }),
                  ]
                });

                this.state.entities.set(client.sessionId, entity);

                client.view = new StateView();
                client.view.add(entity);
              }
              async onLeave(client, code: CloseCode) {
                try {
                  if (code === CloseCode.CONSENTED) { throw new Error("consented!"); }
                  await this.allowReconnection(client, 0.5);
                } catch (e) {}
              }
              onDispose() { onRoomDisposed.resolve(); }
            });

            const roomConnection = await client.joinOrCreate<State>('reconnect_with_stateview');

            // wait for state to sync
            await timeout(80);

            assert.strictEqual(1, roomConnection.state.entities.size);
            assert.strictEqual(2, roomConnection.state.entities.get(roomConnection.sessionId).items.length);

            // forcibly close connection
            roomConnection.connection.transport.close();
            await timeout(50);

            const reconnectedRoom = await client.reconnect<State>(roomConnection.reconnectionToken);

            // wait for state to sync
            await timeout(80);

            assert.strictEqual(1, reconnectedRoom.state.entities.size);
            assert.strictEqual(2, reconnectedRoom.state.entities.get(reconnectedRoom.sessionId).items.length);

            await reconnectedRoom.leave();
          });

        });

        describe("invalid messages", () => {
          it("exceeding maxPayload should close the connection", async () => {
            // no onMessage registered
            matchMaker.defineRoomType('invalid_messages', class _ extends Room {});
            const conn1 = await client.joinOrCreate("invalid_messages");
            conn1.sendBytes("invalid", crypto.randomBytes(MAX_PAYLOAD + 1));
            await timeout(50);
            assert.strictEqual(false, conn1.connection.isOpen);

            // 1 onMessage registered
            matchMaker.defineRoomType('invalid_messages', class _ extends Room {
              onCreate() {
                this.onMessage("dummy", () => {})
              }
            });
            const conn2 = await client.joinOrCreate("invalid_messages");
            conn2.sendBytes("invalid", crypto.randomBytes(MAX_PAYLOAD + 1));
            await timeout(50);
            assert.strictEqual(false, conn1.connection.isOpen);

            // wildcard onMessage registered
            matchMaker.defineRoomType('invalid_messages', class _ extends Room {
              onCreate() {
                this.onMessage("*", () => {})
              }
            });
            const conn3 = await client.joinOrCreate("invalid_messages");
            conn3.sendBytes("invalid", crypto.randomBytes(MAX_PAYLOAD + 1));
            await timeout(50);
            assert.strictEqual(false, conn1.connection.isOpen);
          });

          it("ROOM_DATA: fail to parse should close the connection", async () => {
            // no onMessage registered
            matchMaker.defineRoomType('invalid_messages', class _ extends Room {});
            const conn1 = await client.joinOrCreate("invalid_messages");
            conn1.connection.send(Buffer.from([Protocol.ROOM_DATA, ...crypto.randomBytes(256)]));
            await timeout(50);
            assert.strictEqual(false, conn1.connection.isOpen);

            // 1 onMessage registered
            matchMaker.defineRoomType('invalid_messages', class _ extends Room {
              onCreate() {
                this.onMessage("dummy", () => {});
              }
            });
            const conn2 = await client.joinOrCreate("invalid_messages");
            conn2.connection.send(Buffer.from([Protocol.ROOM_DATA, ...crypto.randomBytes(256)]));
            await timeout(50);
            assert.strictEqual(false, conn2.connection.isOpen);

            // wildcard onMessage registered
            matchMaker.defineRoomType('invalid_messages', class _ extends Room {
              onCreate() {
                this.onMessage("*", () => {});
              }
            });
            const conn3 = await client.joinOrCreate("invalid_messages");
            conn3.connection.send(Buffer.from([Protocol.ROOM_DATA, ...crypto.randomBytes(256)]));
            await timeout(50);
            assert.strictEqual(false, conn3.connection.isOpen);
          });

          it("ROOM_DATA_BYTES: fail to parse should close the connection", async () => {
            // no onMessage registered
            matchMaker.defineRoomType('invalid_messages', class _ extends Room {});
            const conn1 = await client.joinOrCreate("invalid_messages");
            conn1.connection.send(Buffer.from([Protocol.ROOM_DATA_BYTES, ...crypto.randomBytes(256)]));
            await timeout(50);
            assert.strictEqual(false, conn1.connection.isOpen);

            // 1 onMessage registered
            matchMaker.defineRoomType('invalid_messages', class _ extends Room {
              onCreate() {
                this.onMessage('dummy', (_, message) => {});
              }
            });
            const conn2 = await client.joinOrCreate("invalid_messages");
            conn2.connection.send(Buffer.from([Protocol.ROOM_DATA_BYTES, ...crypto.randomBytes(256)]));
            await timeout(50);
            assert.strictEqual(false, conn2.connection.isOpen);

            // wildcard onMessage registered
            const onMessageReceived = new Deferred();
            matchMaker.defineRoomType('invalid_messages', class _ extends Room {
              onCreate() {
                this.onMessage('*', (_, type, message) => {
                  onMessageReceived.resolve([type, message]);
                });
              }
            });
            const conn3 = await client.joinOrCreate("invalid_messages");
            const bytes = crypto.randomBytes(256);
            conn3.connection.send(Buffer.from([Protocol.ROOM_DATA_BYTES, ...bytes]));
            const [_, message] = await onMessageReceived;
            assert.ok(Array.from(bytes).toString().includes(Array.from(message).toString()));
            assert.strictEqual(true, conn3.connection.isOpen);
          });
        })

        describe("Send buffer", () => {
          it("should not overwrite the send buffer when using .send() before .onJoin()", async () => {
            matchMaker.defineRoomType('send_buffer', class extends Room {
              onJoin(client: any, _: any) {
                client.send('u+', { id: client.sessionId });
                this.broadcast('P', this.clients.length);
              }
            });

            const values: number[] = [];

            const conn1 = await client.joinOrCreate('send_buffer');
            conn1.onMessage('*', () => {});
            conn1.onMessage('P', (value) =>
              values.push(value));

            const conn2 = await client.joinOrCreate('send_buffer');
            conn2.onMessage('*', () => {});

            await timeout(100);

            await conn2.leave();
            await conn1.leave();

            assert.deepStrictEqual([1, 2], values);
          });
        });

      });

    }
  }
});

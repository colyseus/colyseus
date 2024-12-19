import assert, { fail } from "assert";
import { Client, ClientState, Deferred, Delayed, LocalDriver, LocalPresence, MatchMakerDriver, Presence, Room, Server, Transport, matchMaker } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import * as Colyseus from "colyseus.js";
import { timeout } from "./utils";

const TEST_PORT = 8568;
const TEST_ENDPOINT = `ws://localhost:${TEST_PORT}`;

describe("MatchMaker Stats", () => {
  let driver: MatchMakerDriver;
  let server: Server;
  let presence: Presence;
  let transport: Transport;

  const client = new Colyseus.Client(TEST_ENDPOINT);

  before(async () => {
    driver = new LocalDriver();
    presence = new LocalPresence();
    transport = new WebSocketTransport({
      pingInterval: 100,
      pingMaxRetries: 3
    });

    server = new Server({
      greet: false,
      gracefullyShutdown: false,
      presence,
      driver,
      transport,
    });

    // setup matchmaker & listen
    await server.listen(TEST_PORT);
  });

  beforeEach(async() => {
    await matchMaker.setup(presence, driver);
    await matchMaker.stats.reset();
    await driver.clear()
  });

  after(async () => {
    await server.gracefullyShutdown(false)
    await driver.clear();
  });

  describe("disposing the room", () => {
    it("using .disconnect() w/ 2 clients connected", async () => {
      let roomId: string;
      const clients: Client[] = [];
      matchMaker.defineRoomType('disconnect_stat', class _ extends Room {
        onCreate() { roomId = this.roomId; }
        onJoin(client) { clients.push(client); }
        async onLeave() { await timeout(5); }
      });

      const promises = [
        client.joinOrCreate('disconnect_stat'),
        client.joinOrCreate('disconnect_stat'),
      ];

      await Promise.all(promises);

      const room = matchMaker.getLocalRoomById(roomId);
      assert.ok(room);

      await room.disconnect();
      await timeout(20);

      assert.strictEqual(0, matchMaker.stats.local.roomCount);
      assert.strictEqual(0, matchMaker.stats.local.ccu);
      assert.ok(!matchMaker.getLocalRoomById(roomId));
    });

    it("using .disconnect() while clients are joining", async () => {
      const onReadyToTest = new Deferred();
      const onRoomDisposed = new Deferred();

      let room: Room;
      let numClientsJoining = 0;
      matchMaker.defineRoomType('disconnect_joining', class _ extends Room {
        onCreate() {
          room = this;
        }
        async onJoin(client) {
          numClientsJoining++;
          if (numClientsJoining === 3) {
            // all clients are still waiting to join
            onReadyToTest.resolve();
          }
          // let the FIRST connection to finish joining...
          // all the others are going to be disconnected
          if (numClientsJoining > 1) {
            await timeout(300);
          }
        }
        async onLeave() {
          await timeout(5);
        }
        onDispose() {
          onRoomDisposed.resolve();
        }
      });

      client.joinOrCreate('disconnect_joining').catch((e) => { });
      client.joinOrCreate('disconnect_joining').catch((e) => { });
      client.joinOrCreate('disconnect_joining').catch((e) => { });

      await onReadyToTest;

      assert.strictEqual(3, numClientsJoining, "3 clients should be joining");

      assert.strictEqual(1, matchMaker.stats.local.roomCount);
      assert.strictEqual(1, matchMaker.stats.local.ccu); // 1

      await room.disconnect();
      await onRoomDisposed;

      assert.strictEqual(0, matchMaker.stats.local.roomCount);
      assert.strictEqual(0, matchMaker.stats.local.ccu);

      // onJoin promise finished...
      await timeout(500);
      assert.strictEqual(0, matchMaker.stats.local.roomCount);
      assert.strictEqual(0, matchMaker.stats.local.ccu);
    });

    it("using client.leave() before 'onJoin' finishes", async () => {
      const clients: Client[] = [];
      const onReadyToTest = new Deferred();
      const onRoomDisposed = new Deferred();

      matchMaker.defineRoomType('manual_leave', class _ extends Room {
        async onJoin(client) {
          clients.push(client);
          if (clients.length === 2) {
            onReadyToTest.resolve();
          }
          await timeout(300);
        }
        async onLeave(client, consented) {}
        onDispose() { onRoomDisposed.resolve(); }
      });

      const clientConnections: Promise<any>[] = [];
      clientConnections.push(client.joinOrCreate('manual_leave').catch((e) => { }));
      clientConnections.push(client.joinOrCreate('manual_leave').catch((e) => { }));

      // wait for all clients to be "joining"
      await onReadyToTest;
      // await timeout(250);

      assert.strictEqual(1, matchMaker.stats.local.roomCount);
      assert.strictEqual(0, matchMaker.stats.local.ccu);

      assert.strictEqual(2, clients.filter((client) => client.state === ClientState.JOINING).length);

      // call 'leave' before 'onJoin' finishes
      clients.map((client) => client.leave());

      await onRoomDisposed;

      assert.strictEqual(0, matchMaker.stats.local.roomCount);
      assert.strictEqual(0, matchMaker.stats.local.ccu);
    });

    it("triggering error during 'onAuth'", async () => {
      const ROOM_NAME = 'error_onleave';

      const onRoomDisposed = new Deferred();
      let onAuthCalled = 0;
      let onJoinCalled = 0;
      let onLeaveCalled = 0;
      let room: Room;
      matchMaker.defineRoomType(ROOM_NAME, class _ extends Room {
        onCreate() {
          this.autoDispose = false;
          room = this;
        }
        async onAuth () {
          onAuthCalled++;
          throw new Error("onAuth error");
        }
        async onJoin(client) {
          onJoinCalled++;
          throw new Error("onJoin error");
        }
        async onLeave(client, consented) {
          onLeaveCalled++;
          throw new Error("onLeave error");
        }
        onDispose() {
          onRoomDisposed.resolve();
        }
      });

      const clientConnections: Promise<any>[] = [];
      clientConnections.push(client.joinOrCreate(ROOM_NAME));
      clientConnections.push(client.joinOrCreate(ROOM_NAME));
      clientConnections.push(client.joinOrCreate(ROOM_NAME));

      // wait for successful join
      await Promise.allSettled(clientConnections);

      assert.strictEqual(1, matchMaker.stats.local.roomCount);
      assert.strictEqual(0, matchMaker.stats.local.ccu);

      assert.strictEqual(3, onAuthCalled);
      assert.strictEqual(0, onJoinCalled);
      assert.strictEqual(0, onLeaveCalled);

      room.disconnect();
      await onRoomDisposed;

      assert.strictEqual(0, matchMaker.stats.local.roomCount);
      assert.strictEqual(0, matchMaker.stats.local.ccu);
    });

    it("triggering error during 'onLeave'", async () => {
      const ROOM_NAME = 'error_onleave';

      const clients: Client[] = [];
      const onReadyToTest = new Deferred();
      const onRoomDisposed = new Deferred();
      matchMaker.defineRoomType(ROOM_NAME, class _ extends Room {
        async onJoin(client) {
          clients.push(client);
          if (clients.length === 3) {
            onReadyToTest.resolve();
          }
          await timeout(400);
        }
        async onLeave(client, consented) {
          await timeout(10);
          throw new Error("onLeave error");
        }
        onDispose() {
          onRoomDisposed.resolve();
        }
      });

      const clientConnections: Promise<any>[] = [];
      clientConnections.push(client.joinOrCreate(ROOM_NAME).catch((e) => {}));
      clientConnections.push(client.joinOrCreate(ROOM_NAME).catch((e) => {}));
      clientConnections.push(client.joinOrCreate(ROOM_NAME).catch((e) => {}));

      // wait for successful join
      await Promise.all(clientConnections);

      assert.strictEqual(1, matchMaker.stats.local.roomCount);
      assert.strictEqual(3, matchMaker.stats.local.ccu);

      // leave all clients
      clients.map((client) => client.leave());

      await onRoomDisposed;
      await timeout(100);

      assert.strictEqual(0, matchMaker.stats.local.roomCount);
      assert.strictEqual(0, matchMaker.stats.local.ccu);
    });

    it("triggering error during 'onLeave' before 'onJoin' finishes", async () => {
      const ROOM_NAME = 'error_onleave';

      const clients: Client[] = [];
      const onReadyToTest = new Deferred();
      const onRoomDisposed = new Deferred();
      matchMaker.defineRoomType(ROOM_NAME, class _ extends Room {
        async onJoin(client) {
          clients.push(client);
          if (clients.length == 2) {
            onReadyToTest.resolve();
          }
          await timeout(400);
        }
        async onLeave(client, consented) {
          await timeout(10);
          throw new Error("onLeave error");
        }
        onDispose() {
          onRoomDisposed.resolve();
        }
      });

      client.joinOrCreate(ROOM_NAME).catch((e) => { })
      client.joinOrCreate(ROOM_NAME).catch((e) => { })

      await onReadyToTest;

      assert.strictEqual(1, matchMaker.stats.local.roomCount);
      assert.strictEqual(0, matchMaker.stats.local.ccu);

      // call 'leave' before 'onJoin' finishes
      clients.map((client) => client.leave());

      await onRoomDisposed;
      await timeout(300);

      assert.strictEqual(0, matchMaker.stats.local.roomCount);
      assert.strictEqual(0, matchMaker.stats.local.ccu);
    });

  })

  it("should maintain stats on reconnection", async () => {
    const onRoomDisposed = new Deferred();
    matchMaker.defineRoomType('allow_reconnection', class _ extends Room {
      async onJoin() { }
      async onLeave(client, consented) {
        try {
          if (consented) {
            throw new Error("consented!");
          }
          await this.allowReconnection(client, 0.1);
        } catch (e) { }
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
    await timeout(5);

    const roomReconnection = await client.reconnect(roomConnection.reconnectionToken);
    assert.strictEqual(1, matchMaker.stats.local.roomCount);
    assert.strictEqual(1, matchMaker.stats.local.ccu);
    await roomReconnection.leave();

    await onRoomDisposed;

    const rooms = await matchMaker.query({});
    assert.strictEqual(0, rooms.length);
    assert.strictEqual(0, matchMaker.stats.local.roomCount);
    assert.strictEqual(0, matchMaker.stats.local.ccu);
  });

  it("should maintain stats on manual reconnection", async () => {
    let onRoomDisposed: Deferred;
    matchMaker.defineRoomType('allow_reconnection', class _ extends Room {
      onCreate() {
        onRoomDisposed = new Deferred();
      }

      onJoin(client, options) {
        client.userData = options;
      }

      onLeave(client, consented) {
        if (consented) { return; }

        const reconnection = this.allowReconnection(client, "manual");
        const delayed = this.clock.setTimeout(() => {
          if (client.userData.fail) {
            reconnection.reject();
          } else {
            // wait for reconnection to succeed.
          }
        }, 10);
        reconnection.then(() => {
          delayed.clear();
        }).catch(() => {
          delayed.clear();
        });
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

    // wait to setup reconnection
    await timeout(10);

    const roomReconnection = await client.reconnect(roomConnection.reconnectionToken);
    assert.strictEqual(1, matchMaker.stats.local.roomCount);
    assert.strictEqual(1, matchMaker.stats.local.ccu);
    await roomReconnection.leave();

    await onRoomDisposed;

    let rooms = await matchMaker.query({});
    assert.strictEqual(0, rooms.length);
    assert.strictEqual(0, matchMaker.stats.local.roomCount);
    assert.strictEqual(0, matchMaker.stats.local.ccu);

    const roomConnection2 = await client.joinOrCreate('allow_reconnection', { fail: true });

    assert.strictEqual(1, matchMaker.stats.local.roomCount);
    assert.strictEqual(1, matchMaker.stats.local.ccu);

    // forcibly close connection
    roomConnection2.connection.transport.close();

    // wait for reconnection to timeout
    await timeout(50);

    assert.rejects(async () =>
      await client.reconnect(roomConnection2.reconnectionToken));

    await onRoomDisposed;

    rooms = await matchMaker.query({});
    assert.strictEqual(0, rooms.length);
    assert.strictEqual(0, matchMaker.stats.local.roomCount);
    assert.strictEqual(0, matchMaker.stats.local.ccu);

  });

});
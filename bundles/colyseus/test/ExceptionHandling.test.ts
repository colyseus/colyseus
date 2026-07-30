import assert from "assert";

import * as Colyseus from "@colyseus/sdk";
import { OnAuthException, OnCreateException, OnDisposeException, OnJoinException, OnLeaveException, OnMessageException, Room, Server, TimestepException, SimulationIntervalException, TimedEventException, matchMaker } from "@colyseus/core";
import { timeout } from "./utils/index.ts";

const TEST_PORT = 8570;
const TEST_ENDPOINT = `ws://localhost:${TEST_PORT}`;

describe("Exception Handling", () => {
  let server: Server;
  let client = new Colyseus.Client(TEST_ENDPOINT);

  beforeEach(async () => {
    server = new Server({ greet: false, gracefullyShutdown: false });

    // setup matchmaker
    matchMaker.setup(undefined, undefined)

    // listen for testing
    await server.listen(TEST_PORT);
  });

  afterEach(async () => {
    // disconnectAll() returns an array of promises, not a promise
    await Promise.all(matchMaker.disconnectAll());
    await server.gracefullyShutdown(false);
  });

  it("onCreate: error should be caught, should not join", async () => {
    let caught: any = { error: undefined, methodName: undefined };

    matchMaker.defineRoomType("my_room", class extends Room {
      onCreate(options: any) {
        throw Error("onCreate Error");
      }
      onUncaughtException(error: Error, methodName: string): void {
        caught.error = error;
        caught.methodName = methodName;
      }
    });

    try {
      await client.joinOrCreate("my_room", { arg0: "arg0" });
      assert.fail("should not join");
    } catch (e) { }

    assert.ok(caught.error instanceof OnCreateException);
    assert.strictEqual(caught.error.message, "onCreate Error");
    assert.strictEqual(caught.methodName, "onCreate");
    assert.deepStrictEqual(caught.error.options, { arg0: "arg0" });
  });

  it("async onCreate: error should be caught, should not join", async () => {
    let caught: any = { error: undefined, methodName: undefined };

    matchMaker.defineRoomType("my_room", class extends Room {
      async onCreate(options: any) {
        await timeout(50);
        throw Error("async onCreate Error");
      }
      onUncaughtException(error: Error, methodName: string): void {
        caught.error = error;
        caught.methodName = methodName;
      }
    });

    try {
      await client.joinOrCreate("my_room", { arg0: "arg0" });
      assert.fail("should not join");
    } catch (e) {}

    assert.ok(caught.error instanceof OnCreateException);
    assert.strictEqual(caught.error.message, "async onCreate Error");
    assert.strictEqual(caught.methodName, "onCreate");
    assert.deepStrictEqual(caught.error.options, { arg0: "arg0" });
  });

  it("onAuth: error should be caught, should not join", async () => {
    let caught: any = { error: undefined, methodName: undefined };
    let onAuthClient: any = undefined;

    matchMaker.defineRoomType("my_room", class extends Room {
      onAuth(client: any, options: any) {
        onAuthClient = client;
        throw Error("onAuth Error");
      }
      onUncaughtException(error: Error, methodName: string): void {
        caught.error = error;
        caught.methodName = methodName;
      }
    });

    try {
      await client.joinOrCreate("my_room", { arg0: "arg0" });
      assert.fail("should not join");
    } catch (e) { }

    assert.ok(caught.error instanceof OnAuthException);
    assert.strictEqual(caught.error.message, "onAuth Error");
    assert.strictEqual(caught.methodName, "onAuth");
    assert.strictEqual(caught.error.client, onAuthClient);
  });

  it("async onAuth: error should be caught, should not join", async () => {
    let caught: any = { error: undefined, methodName: undefined };
    let onAuthClient: any = undefined;

    matchMaker.defineRoomType("my_room", class extends Room {
      async onAuth(client: any, options: any) {
        onAuthClient = client;
        await timeout(50);
        throw Error("async onAuth Error");
      }
      onUncaughtException(error: Error, methodName: string): void {
        caught.error = error;
        caught.methodName = methodName;
      }
    });

    try {
      await client.joinOrCreate("my_room", { arg0: "arg0" });
      assert.fail("should not join");
    } catch (e) { }

    assert.ok(caught.error instanceof OnAuthException);
    assert.strictEqual(caught.error.message, "async onAuth Error");
    assert.strictEqual(caught.methodName, "onAuth");
    assert.strictEqual(caught.error.client, onAuthClient);
  });

  it("onJoin: error should be caught, should not join", async () => {
    let caught: any = { error: undefined, methodName: undefined };
    let onJoinClient: any = undefined;

    matchMaker.defineRoomType("my_room", class extends Room {
      onJoin(client: any, options: any) {
        onJoinClient = client;
        throw Error("onJoin Error");
      }
      onUncaughtException(error: Error, methodName: string): void {
        caught.error = error;
        caught.methodName = methodName;
      }
    });

    try {
      await client.joinOrCreate("my_room", { arg0: "arg0" });
      assert.fail("should not join");
    } catch (e) { }

    assert.ok(caught.error instanceof OnJoinException);
    assert.strictEqual(caught.error.message, "onJoin Error");
    assert.strictEqual(caught.methodName, "onJoin");
    assert.strictEqual(caught.error.client, onJoinClient);
  });

  it("async onJoin: error should be caught, should not join", async () => {
    let caught: any = { error: undefined, methodName: undefined };
    let onJoinClient: any = undefined;

    matchMaker.defineRoomType("my_room", class extends Room {
      async onJoin(client: any, options: any) {
        onJoinClient = client;
        await timeout(50);
        throw Error("async onJoin Error");
      }
      onUncaughtException(error: Error, methodName: string): void {
        caught.error = error;
        caught.methodName = methodName;
      }
    });

    try {
      await client.joinOrCreate("my_room", { arg0: "arg0" });
      assert.fail("should not join");
    } catch (e) { }

    assert.ok(caught.error instanceof OnJoinException);
    assert.strictEqual(caught.error.message, "async onJoin Error");
    assert.strictEqual(caught.methodName, "onJoin");
    assert.strictEqual(caught.error.client, onJoinClient);
  });

  it("onLeave: error should be caught", async () => {
    let caught: any = { error: undefined, methodName: undefined };
    let onLeaveClient: any = undefined;

    matchMaker.defineRoomType("my_room", class extends Room {
      onLeave(client: any, options: any) {
        onLeaveClient = client;
        throw Error("onLeave Error");
      }
      onUncaughtException(error: Error, methodName: string): void {
        caught.error = error;
        caught.methodName = methodName;
      }
    });

    const conn = await client.joinOrCreate("my_room", { arg0: "arg0" });
    await timeout(50);
    await conn.leave();

    assert.ok(caught.error instanceof OnLeaveException);
    assert.strictEqual(caught.error.message, "onLeave Error");
    assert.strictEqual(caught.methodName, "onLeave");
    assert.strictEqual(caught.error.client, onLeaveClient);
  });

  it("async onLeave: error should be caught", async () => {
    let caught: any = { error: undefined, methodName: undefined };
    let onLeaveClient: any = undefined;

    matchMaker.defineRoomType("my_room", class extends Room {
      async onLeave(client: any, options: any) {
        onLeaveClient = client;
        await timeout(50);
        throw Error("async onLeave Error");
      }
      onUncaughtException(error: Error, methodName: string): void {
        caught.error = error;
        caught.methodName = methodName;
      }
    });

    const conn = await client.joinOrCreate("my_room", { arg0: "arg0" });
    await timeout(50);
    await conn.leave();

    assert.ok(caught.error instanceof OnLeaveException);
    assert.strictEqual(caught.error.message, "async onLeave Error");
    assert.strictEqual(caught.methodName, "onLeave");
    assert.strictEqual(caught.error.client, onLeaveClient);
  });

  it("onDispose: error should be caught", async () => {
    let caught: any = { error: undefined, methodName: undefined };

    matchMaker.defineRoomType("my_room", class extends Room {
      onDispose() {
        throw Error("onDispose Error");
      }
      onUncaughtException(error: Error, methodName: string): void {
        caught.error = error;
        caught.methodName = methodName;
      }
    });

    const conn = await client.joinOrCreate("my_room", { arg0: "arg0" });
    await conn.leave();

    assert.ok(caught.error instanceof OnDisposeException);
    assert.strictEqual(caught.error.message, "onDispose Error");
    assert.strictEqual(caught.methodName, "onDispose");
  });

  it("async onDispose: error should be caught", async () => {
    let caught: any = { error: undefined, methodName: undefined };

    matchMaker.defineRoomType("my_room", class extends Room {
      async onDispose() {
        await timeout(50);
        throw Error("async onDispose Error");
      }
      onUncaughtException(error: Error, methodName: string): void {
        caught.error = error;
        caught.methodName = methodName;
      }
    });

    const conn = await client.joinOrCreate("my_room", { arg0: "arg0" });
    await conn.leave();

    await timeout(100);

    assert.ok(caught.error instanceof OnDisposeException);
    assert.strictEqual(caught.error.message, "async onDispose Error");
    assert.strictEqual(caught.methodName, "onDispose");
  });

  it("setTimeout should be caught", async () => {
    let caught: any = { error: undefined, methodName: undefined };

    matchMaker.defineRoomType("my_room", class extends Room {
      onCreate(options: any) {
        this.clock.start();
      }
      onJoin() {
        this.clock.setTimeout((_) => {
          throw new Error("setTimeout Error");
        }, 100, "arg0");
      }
      onUncaughtException(error: Error, methodName: string): void {
        caught.error = error;
        caught.methodName = methodName;
      }
    });

    await client.joinOrCreate("my_room", { arg0: "arg0" });
    await timeout(200);

    assert.ok(caught.error instanceof TimedEventException);
    assert.strictEqual(caught.error.message, "setTimeout Error");
    assert.strictEqual(caught.methodName, "setTimeout");
    assert.deepStrictEqual(caught.error.args, [ "arg0" ]);
  });

  it("async setTimeout should be caught", async () => {
    let caught: any = { error: undefined, methodName: undefined };

    matchMaker.defineRoomType("my_room", class extends Room {
      onCreate(options: any) {
        this.clock.start();
      }
      onJoin() {
        this.clock.setTimeout(async (_) => {
          await timeout(50);
          throw new Error("async setTimeout Error");
        }, 100, "arg0");
      }
      onUncaughtException(error: Error, methodName: string): void {
        caught.error = error;
        caught.methodName = methodName;
      }
    });

    await client.joinOrCreate("my_room", { arg0: "arg0" });
    await timeout(200);

    assert.ok(caught.error instanceof TimedEventException);
    assert.strictEqual(caught.error.message, "async setTimeout Error");
    assert.strictEqual(caught.methodName, "setTimeout");
    assert.deepStrictEqual(caught.error.args, [ "arg0" ]);
  });

  it("setInterval should be caught", async () => {
    let caught: any = { error: undefined, methodName: undefined };

    matchMaker.defineRoomType("my_room", class extends Room {
      onCreate(options: any) {
        this.clock.start();
      }
      onJoin() {
        this.clock.setInterval((_) => {
          throw new Error("setTimeout Error");
        }, 100, "arg0");
      }
      onUncaughtException(error: Error, methodName: string): void {
        caught.error = error;
        caught.methodName = methodName;
      }
    });

    await client.joinOrCreate("my_room", { arg0: "arg0" });
    await timeout(110);

    assert.ok(caught.error instanceof TimedEventException);
    assert.strictEqual(caught.error.message, "setTimeout Error");
    assert.strictEqual(caught.methodName, "setInterval");
    assert.deepStrictEqual(caught.error.args, [ "arg0" ]);
  });

  it("async setInterval should be caught", async () => {
    let caught: any = { error: undefined, methodName: undefined };

    matchMaker.defineRoomType("my_room", class extends Room {
      onCreate(options: any) {
        this.clock.start();
      }
      onJoin() {
        this.clock.setInterval(async (_) => {
          await timeout(50);
          throw new Error("async setTimeout Error");
        }, 100, "arg0");
      }
      onUncaughtException(error, methodName): void {
        caught.error = error;
        caught.methodName = methodName;
      }
    });

    await client.joinOrCreate("my_room", { arg0: "arg0" });
    await timeout(200);

    assert.ok(caught.error instanceof TimedEventException);
    assert.strictEqual(caught.error.message, "async setTimeout Error");
    assert.strictEqual(caught.methodName, "setInterval");
    assert.deepStrictEqual(caught.error.args, [ "arg0" ]);
  });

  it("onMessage: error should be caught", async () => {
    let caught: any = { error: undefined, methodName: undefined };
    let onMessageArgs: any = undefined;

    matchMaker.defineRoomType("my_room", class extends Room {
      onCreate() {
        this.onMessage("foo", (client, message) => {
          onMessageArgs = [client, message];
          throw new Error("onMessage Error");
        });
      }
      onUncaughtException(error: Error, methodName: string): void {
        caught.error = error;
        caught.methodName = methodName;
      }
    });

    const conn = await client.joinOrCreate("my_room", { arg0: "arg0" });
    await conn.send("foo", "bar");
    await conn.leave();

    assert.ok(caught.error instanceof OnMessageException);
    assert.strictEqual(caught.error.message, "onMessage Error");
    assert.strictEqual(caught.methodName, "onMessage");
    assert.deepStrictEqual(caught.error.client, onMessageArgs[0]);
    assert.deepStrictEqual(caught.error.type, "foo");
    assert.deepStrictEqual(caught.error.payload, onMessageArgs[1]);
  });

  it("async onMessage: error should be caught", async () => {
    let caught: any = { error: undefined, methodName: undefined };
    let onMessageArgs: any = undefined;

    matchMaker.defineRoomType("my_room", class extends Room {
      onCreate() {
        this.onMessage("foo", async (client, message) => {
          onMessageArgs = [client, message];
          await timeout(50);
          throw new Error("async onMessage Error");
        });
      }
      onUncaughtException(error: Error, methodName: string): void {
        caught.error = error;
        caught.methodName = methodName;
      }
    });

    const conn = await client.joinOrCreate("my_room", { arg0: "arg0" });
    await conn.send("foo", "bar");
    await timeout(50);
    await conn.leave();

    assert.ok(caught.error instanceof OnMessageException);
    assert.strictEqual(caught.error.message, "async onMessage Error");
    assert.strictEqual(caught.methodName, "onMessage");
    assert.deepStrictEqual(caught.error.client, onMessageArgs[0]);
    assert.deepStrictEqual(caught.error.type, "foo");
    assert.deepStrictEqual(caught.error.payload, onMessageArgs[1]);
  });

  it("request onMessage: handler throw should be caught with correct type/payload", async () => {
    let caught: any = { error: undefined, methodName: undefined };

    matchMaker.defineRoomType("my_room", class extends Room {
      onCreate() {
        this.onMessage("req", (_client, _message) => {
          throw new Error("request onMessage Error");
        });
      }
      onUncaughtException(error: Error, methodName: string): void {
        caught.error = error;
        caught.methodName = methodName;
      }
    });

    const conn = await client.joinOrCreate("my_room", { arg0: "arg0" });
    // onUncaughtException swallows the throw, so the request settles (OK/undefined)
    // rather than rejecting — but the exception is still reported with the right type.
    await conn.request("req", { n: 1 });
    await conn.leave();

    assert.ok(caught.error instanceof OnMessageException);
    assert.strictEqual(caught.error.message, "request onMessage Error");
    assert.strictEqual(caught.methodName, "onMessage");
    assert.strictEqual(caught.error.type, "req");
    assert.ok(caught.error.isType("req"));
    assert.deepStrictEqual(caught.error.payload, { n: 1 });
  });

  it("wildcard onMessage('*'): error should be caught with the RECEIVED type/payload", async () => {
    let caught: any = { error: undefined, methodName: undefined };

    matchMaker.defineRoomType("my_room", class extends Room {
      onCreate() {
        // wildcard handler signature is (client, type, message)
        this.onMessage("*", (_client, _type, _message) => {
          throw new Error("wildcard onMessage Error");
        });
      }
      onUncaughtException(error: Error, methodName: string): void {
        caught.error = error;
        caught.methodName = methodName;
      }
    });

    const conn = await client.joinOrCreate("my_room", { arg0: "arg0" });
    await conn.send("some_type", { hello: "world" });
    await conn.leave();

    assert.ok(caught.error instanceof OnMessageException);
    assert.strictEqual(caught.error.message, "wildcard onMessage Error");
    assert.strictEqual(caught.methodName, "onMessage");
    assert.strictEqual(caught.error.type, "some_type"); // the received type, not '*'
    assert.ok(caught.error.isType("some_type"));
    assert.deepStrictEqual(caught.error.payload, { hello: "world" });
  });

  it("setTimestep: error should be caught", async () => {
    let caught: any = [];

    matchMaker.defineRoomType("my_room", class extends Room {
      onCreate() {
        this.setTimestep(() => {
          throw new Error("setTimestep Error");
        });
      }
      onUncaughtException(error: Error, methodName: string): void {
        caught.push({ error, methodName });
      }
    });

    const conn = await client.joinOrCreate("my_room", { arg0: "arg0" });
    await timeout(200);
    await conn.leave();

    assert.ok(caught[0].error instanceof TimestepException);
    assert.strictEqual(caught[0].error.message, "setTimestep Error");
    assert.strictEqual(caught[0].methodName, "setTimestep");
  });

  it("setSimulationInterval (deprecated alias): error should still be caught", async () => {
    let caught: any = [];

    matchMaker.defineRoomType("my_room", class extends Room {
      onCreate() {
        this.setSimulationInterval(() => {
          throw new Error("setSimulationInterval Error");
        });
      }
      onUncaughtException(error: Error, methodName: string): void {
        caught.push({ error, methodName });
      }
    });

    const conn = await client.joinOrCreate("my_room", { arg0: "arg0" });
    await timeout(200);
    await conn.leave();

    // forwards to setTimestep unchanged: same exception, canonical methodName.
    assert.ok(caught[0].error instanceof TimestepException);
    assert.ok(caught[0].error instanceof SimulationIntervalException); // deprecated alias still matches
    assert.strictEqual(caught[0].error.message, "setSimulationInterval Error");
    assert.strictEqual(caught[0].methodName, "setTimestep");
  });

});

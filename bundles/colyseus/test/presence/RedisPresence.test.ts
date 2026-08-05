import assert from "assert";
import { Redis } from "ioredis";
import { RedisPresence } from "@colyseus/redis-presence";

import { timeout } from "../utils/index.ts";

/**
 * Simulate a network-level drop. Unlike `disconnect()`, this leaves ioredis free
 * to reconnect on its own, which is what happens on a real Redis blip.
 */
function dropConnection(presence: RedisPresence) {
  (presence['sub'] as any).stream.destroy();
}

function onceReady(presence: RedisPresence) {
  return new Promise<void>((resolve) => (presence['sub'] as any).once('ready', () => resolve()));
}

describe("RedisPresence", () => {

  describe("constructor with pre-created client", () => {
    it("should accept an existing Redis client", async () => {
      const client = new Redis();
      const presence = new RedisPresence(client);

      await presence.set("injected-key", "hello");
      assert.strictEqual("hello", await presence.get("injected-key"));
      await presence.del("injected-key");

      presence.shutdown();
    });

    it("should support pub/sub when client is injected", async () => {
      const client = new Redis();
      const presence = new RedisPresence(client);

      let received: any = null;
      await presence.subscribe("injected-topic", (data) => {
        received = data;
      });

      await presence.publish("injected-topic", "test-message");
      await timeout(50);

      assert.strictEqual("test-message", received);

      await presence.unsubscribe("injected-topic");
      presence.shutdown();
    });
  });

  describe("connection options", () => {
    it("should disable the ready check on the subscriber connection", async () => {
      // The ready check issues INFO, which Redis rejects in subscriber mode. ioredis
      // then skips readyHandler() — the only place autoResubscribe runs.
      const presence = new RedisPresence();
      assert.strictEqual(false, (presence['sub'] as any).options.enableReadyCheck);
      presence.shutdown();
    });

    it("should disable the ready check on the subscriber connection when a client is injected", async () => {
      const client = new Redis();
      const presence = new RedisPresence(client);
      assert.strictEqual(false, (presence['sub'] as any).options.enableReadyCheck);
      presence.shutdown();
    });

    it("should keep the ready check on the publisher connection", async () => {
      const presence = new RedisPresence();
      assert.notStrictEqual(false, (presence['pub'] as any).options.enableReadyCheck);
      presence.shutdown();
    });

    it("should listen for 'error' on both connections", async () => {
      // Without listeners ioredis logs "Unhandled error event" and connection
      // failures stay invisible until matchmaking silently breaks.
      const presence = new RedisPresence();
      assert.ok((presence['sub'] as any).listenerCount('error') > 0);
      assert.ok((presence['pub'] as any).listenerCount('error') > 0);
      presence.shutdown();
    });
  });

  describe("subscription recovery", () => {
    let presence: RedisPresence;

    beforeEach(() => presence = new RedisPresence());
    afterEach(() => presence.shutdown());

    it("should restore subscriptions after the connection drops", async () => {
      const topic = "recover-" + Date.now();
      let received: any = null;
      await presence.subscribe(topic, (data) => received = data);

      dropConnection(presence);
      await onceReady(presence);
      await timeout(100); // let the re-SUBSCRIBE land

      assert.deepStrictEqual([topic], await presence.channels(topic));

      await presence.publish(topic, { after: "reconnect" });
      await timeout(50);

      assert.deepStrictEqual({ after: "reconnect" }, received);
    });

    it("should restore every subscribed topic, not just one", async () => {
      const suffix = "-multi-" + Date.now();
      const topics = ["a" + suffix, "b" + suffix, "c" + suffix];

      const received: string[] = [];
      for (const topic of topics) {
        await presence.subscribe(topic, () => received.push(topic));
      }

      dropConnection(presence);
      await onceReady(presence);
      await timeout(100);

      for (const topic of topics) {
        await presence.publish(topic, 1);
      }
      await timeout(50);

      assert.deepStrictEqual(topics.sort(), received.sort());
    });

    it("should not duplicate delivery after repeated reconnects", async () => {
      // ioredis' autoResubscribe and our own reconciliation both issue SUBSCRIBE.
      // SUBSCRIBE is idempotent, so the callback must still fire exactly once.
      const topic = "no-dupes-" + Date.now();
      let calls = 0;
      await presence.subscribe(topic, () => calls++);

      for (let i = 0; i < 3; i++) {
        dropConnection(presence);
        await onceReady(presence);
        await timeout(100);
      }

      calls = 0;
      await presence.publish(topic, 1);
      await timeout(100);

      assert.strictEqual(1, calls);
    });

    it("should recover a subscription that failed while the connection was closed", async () => {
      // `subscribe()` registers the local listener before awaiting SUBSCRIBE. If that
      // SUBSCRIBE is rejected (connection closed, or flushed mid-reconnect), nothing
      // retries it — the topic would stay silently dead without reconciliation.
      const topic = "failed-subscribe-" + Date.now();
      let received: any = null;

      // the other tests reach 'ready' implicitly via their first `subscribe()`
      if ((presence['sub'] as any).status !== 'ready') { await onceReady(presence); }

      (presence['sub'] as any).disconnect();

      let rejected = false;
      await presence.subscribe(topic, (data) => received = data).catch(() => rejected = true);
      assert.strictEqual(true, rejected, "SUBSCRIBE should reject while the connection is closed");

      (presence['sub'] as any).connect();
      await onceReady(presence);
      await timeout(100);

      assert.deepStrictEqual([topic], await presence.channels(topic));

      await presence.publish(topic, { healed: true });
      await timeout(50);

      assert.deepStrictEqual({ healed: true }, received);
    });

    it("should not re-subscribe topics that were explicitly unsubscribed", async () => {
      const topic = "unsub-" + Date.now();
      await presence.subscribe(topic, () => assert.fail("should not trigger"));
      await presence.unsubscribe(topic);

      dropConnection(presence);
      await onceReady(presence);
      await timeout(100);

      assert.deepStrictEqual([], await presence.channels(topic));
    });
  });

});

import assert from "assert";
import { LocalPresence, Presence, RedisPresence } from "../src";
import { timeout } from "./utils";

const PRESENCE_IMPLEMENTATIONS = [LocalPresence, RedisPresence];

describe("Presence", () => {

  for (let i = 0; i < PRESENCE_IMPLEMENTATIONS.length; i++) {
    let presence: Presence;

    describe(`Presence:${(PRESENCE_IMPLEMENTATIONS[i]).name}`, () => {
      beforeEach(() => presence = new PRESENCE_IMPLEMENTATIONS[i]())
      afterEach(() => presence.shutdown());

      it("subscribe", async () => {
        let i = 0;

        await presence.subscribe("topic", (data) => {
          if (i === 0) {
            assert.equal("string", data);

          } else if (i === 1) {
            assert.equal(1000, data);

          } else if (i === 2) {
            assert.deepEqual({ object: "hello world" }, data);
          }

          i++;

          if (i === 3) {
            presence.unsubscribe("topic");
          }
        });

        await presence.publish("topic", "string");
        await presence.publish("topic", 1000);
        await presence.publish("topic", { object: "hello world" });

        await timeout(10);

        assert.equal(i, 3);
      });

      it("subscribe: multiple callbacks for same topic", async () => {
        let messages: any[] = [];
        const callback1 = (data) => messages.push(data);
        const callback2 = (data) => messages.push(data);
        const callback3 = (data) => messages.push(data);

        await presence.subscribe("topic-multi", callback1);
        await presence.subscribe("topic-multi", callback2);
        await presence.subscribe("topic-multi", callback3);
        await presence.publish("topic-multi", 1);

        await timeout(10);

        assert.deepEqual([1, 1, 1], messages);

        await presence.unsubscribe("topic-multi", callback1);
        await presence.publish("topic-multi", 1);

        await timeout(10);

        assert.deepEqual([1, 1, 1, 1, 1], messages);
      })

      it("subscribe: topics should not collide", async () => {
        let messages: any[] = [];
        const callback1 = (data) => messages.push(data);
        const callback2 = (data) => messages.push(data);
        const callback3 = (data) => messages.push(data);
        const callback4 = (data) => messages.push(data);

        // subscribe to each topic twice
        await presence.subscribe("topic-collide1", callback1);
        await presence.subscribe("topic-collide1", callback2);
        await presence.subscribe("topic-collide2", callback3);
        await presence.subscribe("topic-collide2", callback4);

        await presence.publish("topic-collide1", 1);
        await presence.publish("topic-collide1", 2);
        await presence.publish("topic-collide2", 3);
        await presence.publish("topic-collide2", 4);

        await timeout(10);
        assert.deepEqual([1, 1, 2, 2, 3, 3, 4, 4], messages);

        // leave duplicated subscriptions
        await presence.unsubscribe("topic-collide1", callback2);
        await presence.unsubscribe("topic-collide2", callback4);

        messages = [];
        await presence.publish("topic-collide1", 1);
        await presence.publish("topic-collide1", 2);
        await presence.publish("topic-collide2", 3);
        await presence.publish("topic-collide2", 4);

        await timeout(10);
        assert.deepEqual([1, 2, 3, 4], messages);

        // leave all subscriptions...
        assert.ok(presence['subscriptions'].listenerCount("topic-collide1") > 0);
        assert.ok(presence['subscriptions'].listenerCount("topic-collide2") > 0);
        await presence.unsubscribe("topic-collide1", callback1);
        await presence.unsubscribe("topic-collide2", callback3);
        assert.strictEqual(0, presence['subscriptions'].listenerCount("topic-collide1"));
        assert.strictEqual(0, presence['subscriptions'].listenerCount("topic-collide2"));

        messages = [];
        await presence.publish("topic-collide1", 1000);
        await presence.publish("topic-collide2", 2000);

        await timeout(10);
        assert.deepEqual([], messages);
      });

      it("unsubscribe", async () => {
        presence.subscribe("topic2", (_) => assert.fail("should not trigger"));
        presence.unsubscribe("topic2");
        presence.publish("topic2", "hello world!");
        assert.ok(true);
      });

      it("unsubscribe from non-existing callback", async () => {
        let callCount = 0;
        await presence.subscribe("topic", (_) => { callCount++; });
        await presence.unsubscribe("topic", function() {});
        await presence.publish("topic", "hello world!");
        await timeout(10);
        assert.strictEqual(1, callCount);
      });

      it("unsubscribe while triggering", async () => {
        const topic = "unsubscribe-ongoing";

        let calls = [];

        const one = (_) => calls.push("one");
        const two = (_) => calls.push("two");
        const three = (_) => calls.push("three");
        const four = (_) => calls.push("four");

        await presence.subscribe(topic, one);
        await presence.subscribe(topic, two);
        await presence.subscribe(topic, async () => {
          await presence.unsubscribe(topic, four);

        });
        await presence.subscribe(topic, three);
        await presence.subscribe(topic, four);

        await presence.publish(topic, {});
        await timeout(10);

        assert.deepStrictEqual(["one", "two", "three", "four"], calls);
      });

      it("exists", async () => {
        await presence.set("exists1", "hello world");
        assert.equal(true, await presence.exists("exists1"));
        assert.equal(false, await presence.exists("exists2"));

        await presence.del("exists1");
        assert.equal(false, await presence.exists("exists1"));
      });

      it("set", async () => {
        await presence.set("setval1", "hello world");
        assert.equal("hello world", await presence.get("setval1"));

        await presence.del("setval1");
        assert.equal(undefined, await presence.get("setval1"));
      });

      it("setex", async () => {
        await presence.setex("setex1", "hello world", 1);
        assert.equal("hello world", await presence.get("setex1"));

        await timeout(1100);
        assert.ok(!(await presence.get("setex1")));
      });

      it("get", async () => {
        await presence.setex("setex2", "one", 1);
        assert.equal("one", await presence.get("setex2"));

        await presence.setex("setex3", "two", 1);
        assert.equal("two", await presence.get("setex3"));
      });

      it("del", async () => {
        await presence.setex("setex4", "one", 1);
        await presence.del("setex4");
        assert.ok(!(await presence.get("setex4")));
      });

      it("sadd/smembers/srem (sets)", async () => {
        await presence.sadd("set", 1);
        await presence.sadd("set", 2);
        await presence.sadd("set", 3);
        assert.deepEqual([1, 2, 3], await presence.smembers("set"));
        assert.equal(3, await presence.scard("set"));

        await presence.srem("set", 2);
        assert.deepEqual([1, 3], await presence.smembers("set"));
        assert.equal(2, await presence.scard("set"));

        await presence.del("set");
        assert.equal(0, await presence.scard("set"));
      });

      it("sismember", async () => {
        await presence.sadd("sis", "testvalue");
        await presence.sadd("sis", "anothervalue");
        assert.equal(1, await presence.sismember("sis", "testvalue"));
        assert.equal(1, await presence.sismember("sis", "anothervalue"));
        assert.equal(0, await presence.sismember("sis", "notexistskey"));
      });

      it("sinter - intersection between sets", async () => {
        await presence.sadd("key1", "a");
        await presence.sadd("key1", "b");
        await presence.sadd("key1", "c");
        await presence.sadd("key2", "c");
        await presence.sadd("key2", "d");
        await presence.sadd("key2", "e");

        const intersection = await presence.sinter("key1", "key2");
        assert.deepEqual(["c"], intersection);
      });

      it("hset/hget/hdel/hlen (hashes)", async () => {
        await presence.hset("hash", "one", "1");
        await presence.hset("hash", "two", "2");
        await presence.hset("hash", "three", "3");

        assert.equal(3, await presence.hlen("hash"));
        assert.equal("1", await presence.hget("hash", "one"));
        assert.equal("2", await presence.hget("hash", "two"));
        assert.equal("3", await presence.hget("hash", "three"));
        assert.ok(!(await presence.hget("hash", "four")));

        const hdelSuccess = await presence.hdel("hash", "two");
        assert.equal(true, hdelSuccess);
        assert.equal(2, await presence.hlen("hash"));
        assert.ok(!(await presence.hget("hash", "two")));

        const hdelFailure = await presence.hdel("none", "none");
        assert.equal(false, hdelFailure);
      });

      it("incr", async () => {
        await presence.del("num"); //ensure key doens't exist before testing

        var incr: number;

        incr = await presence.incr("num");
        assert.strictEqual(1, incr);

        incr = await presence.incr("num");
        assert.strictEqual(2, incr);

        incr = await presence.incr("num");
        assert.strictEqual(3, incr);

        assert.equal(3, await presence.get("num"));
      });

      it("decr", async () => {
        await presence.del("num"); //ensure key doens't exist before testing

        var decr: number;

        decr = await presence.decr("num");
        assert.strictEqual(-1, decr);

        decr = await presence.decr("num");
        assert.strictEqual(-2, decr);

        decr = await presence.decr("num");
        assert.strictEqual(-3, decr);

        assert.equal(-3, await presence.get("num"));
      });

      it("hincrby", async () => {
        await presence.del("hincrby"); //ensure key doens't exist before testing

        var hincrby: number;

        hincrby = await presence.hincrby("hincrby", "one", 1);
        assert.strictEqual(1, hincrby);

        hincrby = await presence.hincrby("hincrby", "one", 1);
        assert.strictEqual(2, hincrby);

        hincrby = await presence.hincrby("hincrby", "one", 1);
        assert.strictEqual(3, hincrby);

        assert.strictEqual('3', await presence.hget("hincrby", "one"));
      });

      it("channels", async () => {
        await presence.subscribe("p:one", () => {});
        await presence.subscribe("$one", () => {});
        await presence.subscribe("p:two", () => {});
        await presence.subscribe("$two", () => {});
        await presence.subscribe("one.two", () => {});

        const channels = await presence.channels();
        assert.deepStrictEqual(["p:one", "$one", "p:two", "$two", "one.two"].sort(), channels.sort());

        const pChannels = await presence.channels("p:*");
        assert.deepStrictEqual(["p:one", "p:two"], pChannels.sort());

        const $Channels = await presence.channels("$*");
        assert.deepStrictEqual(["$one", "$two"], $Channels.sort());

        const dotChannels = await presence.channels("*.*");
        assert.deepStrictEqual(["one.two"], dotChannels.sort());
      });

      describe("brpop", () => {
        it("brpop should return existing item", async () => {
          await presence.lpush("brpop", "one", "two", "three");
          const result = await presence.brpop("brpop", 1);
          assert.deepStrictEqual(["brpop", "one"], result);
        });

        it("brpop should return new item", async () => {
          let result: string[] = undefined;
          presence.brpop("brpop", 1).then((r) => {
            result = r;
          }).catch((e) => {
            result = null;
          });

          await presence.lpush("brpop", "one", "two", "three");

          await timeout(200);
          assert.deepStrictEqual(["brpop", "one"], result);
        });

        it("brpop should return null if no item is available", async () => {
          const result = await presence.brpop("none", 0.1);
          assert.deepStrictEqual(null, result);
        });

      });

      describe("hincrbyex", () => {
        it("hincrbyex should increment the value", async () => {
          const value1 = await presence.hincrbyex("hincrbyex", "one", 1, 1);
          assert.strictEqual(1, value1);
          assert.strictEqual("1", await presence.hget("hincrbyex", "one"));
        });

        it("hincrbyex should expire the key after the given time", async () => {
          await presence.hincrbyex("hincrbyex", "expired", 1, 1);
          assert.strictEqual("1", await presence.hget("hincrbyex", "expired"));
          await timeout(1200);
          assert.strictEqual(null, await presence.hget("hincrbyex", "expired"));
        });

      });

    });

  }
});


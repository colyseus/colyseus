import assert from "assert";
import { timeout, PRESENCE_IMPLEMENTATIONS } from "./utils";


describe("Presence", () => {

  for (let i = 0; i < PRESENCE_IMPLEMENTATIONS.length; i++) {
    const presence = PRESENCE_IMPLEMENTATIONS[i];

    describe((presence as any).constructor.name, () => {

      it("subscribe", (done) => {
        let i = 0;

        presence.subscribe("topic", (data) => {
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
            done();
          }
        });

        presence.publish("topic", "string");
        presence.publish("topic", 1000);
        presence.publish("topic", { object: "hello world" });
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
        await presence.unsubscribe("topic-collide1", callback1);
        await presence.unsubscribe("topic-collide2", callback3);

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

      it("exists", async () => {
        await presence.subscribe("exists1", () => {});
        assert.equal(true, await presence.exists("exists1"));
        assert.equal(false, await presence.exists("exists2"));
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

        await presence.hdel("hash", "two");
        assert.equal(2, await presence.hlen("hash"));
        assert.ok(!(await presence.hget("hash", "two")));
      });

      it("incr", async () => {
        await presence.del("num"); //ensure key doens't exist before testing

        await presence.incr("num");
        await presence.incr("num");
        await presence.incr("num");
        assert.equal(3, await presence.get("num"));
      });

      it("decr", async () => {
        await presence.del("num"); //ensure key doens't exist before testing

        await presence.decr("num");
        await presence.decr("num");
        await presence.decr("num");
        assert.equal(-3, await presence.get("num"));
      });

    });

  }
});


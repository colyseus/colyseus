import assert from "assert";
import { LocalPresence, Presence, RedisPresence } from "../src";
import { awaitForTimeout } from "./utils";

const IMPLEMENTATIONS: Presence[] = [
  new LocalPresence(),
  new RedisPresence()
]

describe("Presence", () => {

  for (let i = 0; i < IMPLEMENTATIONS.length; i++) {
    const presence = IMPLEMENTATIONS[i];

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

        await awaitForTimeout(1100);
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


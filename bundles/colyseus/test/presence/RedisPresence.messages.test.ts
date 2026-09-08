import assert from "assert";
import sinon from "sinon";
import { logger } from "@colyseus/core";
import { RedisPresence } from "@colyseus/redis-presence";

describe("RedisPresence message handling", () => {
  let presence: RedisPresence;
  let warn: sinon.SinonStub;

  beforeEach(() => {
    // Exercise ioredis' message event without connecting to a Redis server.
    presence = new RedisPresence({ lazyConnect: true });
    presence['sub'].on('message', presence['handleSubscription']);
    warn = sinon.stub(logger, 'warn');
  });

  afterEach(() => {
    warn.restore();
    presence['sub'].disconnect();
    presence['pub'].disconnect();
  });

  for (const message of ['', 'not json', '{"incomplete":']) {
    it(`should ignore malformed JSON ${JSON.stringify(message)} and deliver subsequent messages`, () => {
      const received: unknown[] = [];
      presence['subscriptions'].on('topic', (data) => received.push(data));

      assert.doesNotThrow(() => presence['sub'].emit('message', 'topic', message));
      assert.deepStrictEqual(received, []);
      assert.strictEqual(warn.callCount, 1);

      presence['sub'].emit('message', 'topic', '{"ok":true}');
      assert.deepStrictEqual(received, [{ ok: true }]);
    });
  }

  it("should deliver all valid JSON values, including falsy ones", () => {
    const values = [null, false, 0, '', 'hello', [], { value: 1 }];
    const received: unknown[] = [];
    presence['subscriptions'].on('topic', (data) => received.push(data));

    for (const value of values) {
      presence['sub'].emit('message', 'topic', JSON.stringify(value));
    }

    assert.deepStrictEqual(received, values);
    assert.strictEqual(warn.callCount, 0);
  });

  it("should not swallow subscription callback errors", () => {
    const error = new Error('application callback failed');
    presence['subscriptions'].on('topic', () => { throw error; });

    assert.throws(() => presence['sub'].emit('message', 'topic', '{}'), (thrown) => thrown === error);
    assert.strictEqual(warn.callCount, 0);
  });
});

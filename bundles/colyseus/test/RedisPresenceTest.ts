import assert from 'assert';
import MockRedis from 'ioredis-mock';
import mock from 'mock-require';
import type { RedisPresence } from '../../../packages/presence/redis-presence';

mock('ioredis', MockRedis);

describe('RedisPresence', () => {
  const redis = new MockRedis();

  afterEach(redis.flushall);

  it('connects to a single Redis node', async () => {
    const {
      RedisPresence,
    } = require('../../../packages/presence/redis-presence/src/index');
    const presence: RedisPresence = new RedisPresence();

    assert.strictEqual(presence.pub instanceof MockRedis.Cluster, false);
    assert.strictEqual(presence.sub instanceof MockRedis.Cluster, false);
  })

  it('connects to a Redis cluster', async () => {
    const {
      RedisPresence,
    } = require('../../../packages/presence/redis-presence/src/index');
    const presence: RedisPresence = new RedisPresence(['redis://127.0.0.1:6379']);

    assert.strictEqual(presence.pub instanceof MockRedis.Cluster, true);
    assert.strictEqual(presence.sub instanceof MockRedis.Cluster, true);
  })
});

import assert from 'assert';
import MockRedis from 'ioredis-mock';
import mock from 'mock-require';
import type { RedisDriver } from '../../../packages/drivers/redis-driver/src/index';

mock('ioredis', MockRedis);

describe('RedisDriver', () => {
  const redis = new MockRedis();

  afterEach(redis.flushall);

  it('connects to a single Redis node', async () => {
    const {
      RedisDriver,
    } = require('../../../packages/drivers/redis-driver/src/index');
    const driver: RedisDriver = new RedisDriver();

    assert.strictEqual((driver as any)._client instanceof MockRedis.Cluster, false);
  })

  it('connects to a Redis cluster', async () => {
    const {
      RedisDriver,
    } = require('../../../packages/drivers/redis-driver/src/index');
    const driver: RedisDriver = new RedisDriver(['redis://127.0.0.1:6379']);

    assert.strictEqual((driver as any)._client instanceof MockRedis.Cluster, true);
  })

  for (const [keyArgument, expectedKey] of [
    [undefined, 'roomcaches'],
    ['another-key', 'another-key'],
  ]) {
    it(`uses Redis item key ${expectedKey} if the key in constructor argument is ${keyArgument}`, async () => {
      const {
        RedisDriver,
      } = require('../../../packages/drivers/redis-driver/src/index');
      const driver: RedisDriver = new RedisDriver(undefined, undefined, keyArgument);

      const room = driver.createInstance({ roomId: 'test-room-id' });
      await room.save();
      assert.strictEqual(await redis.hexists(expectedKey, room.roomId), 1);

      const rooms = await driver.getRooms();
      assert.strictEqual(rooms.length, 1);
      assert.strictEqual(rooms[0].roomId, room.roomId);

      await room.remove();
      assert.strictEqual(await redis.hexists(expectedKey, room.roomId), 0);
    });
  }
});

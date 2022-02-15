import { RedisDriver } from '../../../packages/drivers/redis-driver/src/index';
import redis from 'redis';
import sinon from 'sinon';

describe('RedisDriver', () => {
  const mockRedis = {
    del: sinon.spy(),
    hdel: sinon.stub().callsFake((_key, _field, cb) => cb(null)),
    hgetall: sinon.stub().callsFake((_key, cb) => cb(null, [])),
    hset: sinon.stub().callsFake((_key, _field, _val, cb) => cb(null)),
  };

  beforeEach(() => {
    sinon
      .mock(redis)
      .expects('createClient')
      .callsFake(() => mockRedis);
  });

  afterEach(() => {
    sinon.resetHistory();
    sinon.restore();
  });

  for (const [keyArgument, expectedKey] of [
    [undefined, 'roomcaches'],
    ['another-key', 'another-key'],
  ]) {
    it(`uses Redis item key ${expectedKey} if the key in constructor argument is ${keyArgument}`, async () => {
      const driver = new RedisDriver(undefined, keyArgument);

      await driver.getRooms();
      sinon.assert.calledOnceWithExactly(
        mockRedis.hgetall,
        expectedKey,
        sinon.match.any,
      );

      driver.clear();
      sinon.assert.calledOnceWithExactly(mockRedis.del, expectedKey);

      const expectedField = 'test-room-id';
      const room = driver.createInstance({ roomId: expectedField });
      await room.remove();
      sinon.assert.calledOnceWithExactly(
        mockRedis.hdel,
        expectedKey,
        expectedField,
        sinon.match.any,
      );

      await room.save();
      sinon.assert.calledOnceWithExactly(
        mockRedis.hset,
        expectedKey,
        expectedField,
        sinon.match.any,
        sinon.match.any,
      );
    });
  }
});

import assert from 'node:assert/strict';
import sinon from 'sinon';
import { createRouter, matchMaker, LocalDriver, LocalPresence } from '@colyseus/core';
import { monitor } from '@colyseus/monitor';

describe('Monitor process memory', () => {
  beforeEach(async () => {
    await matchMaker.setup(new LocalPresence(), new LocalDriver());
  });

  afterEach(async () => {
    sinon.restore();
    await matchMaker.gracefullyShutdown();
  });

  it('reports RSS in megabytes and preserves the system memory fields', async () => {
    const rss = sinon.stub(process.memoryUsage, 'rss');
    rss.onFirstCall().returns(157286400);
    rss.onSecondCall().returns(201850880);
    const router = createRouter({ ...monitor() });

    const response = await router.handler(new Request('http://localhost/monitor/api'));
    assert.equal(response.status, 200);
    const data = await response.json();

    assert.equal(data.memory.rssMb, 150);
    assert.equal(rss.callCount, 1);
    assert.ok(Object.hasOwn(data.memory, 'totalMemMb'));
    assert.ok(Object.hasOwn(data.memory, 'usedMemMb'));
    assert.deepEqual(data.rooms, []);
    assert.equal(data.connections, 0);

    const nextResponse = await router.handler(new Request('http://localhost/monitor/api'));
    assert.equal((await nextResponse.json()).memory.rssMb, 192.5);
    assert.equal(rss.callCount, 2);
  });
});

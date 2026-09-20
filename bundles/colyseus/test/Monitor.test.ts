import assert from 'node:assert/strict';
import sinon from 'sinon';
import { createRouter, matchMaker, LocalDriver, LocalPresence } from '@colyseus/core';
import { monitor } from '@colyseus/monitor';

const MB = 1024 * 1024;

describe('Monitor process memory', () => {
  let router: ReturnType<typeof createRouter>;

  const fetchApi = () => router
    .handler(new Request('http://localhost/monitor/api'))
    .then((response) => {
      assert.equal(response.status, 200);
      return response.json();
    });

  beforeEach(async () => {
    await matchMaker.setup(new LocalPresence(), new LocalDriver());
    router = createRouter({ ...monitor() });
  });

  afterEach(async () => {
    sinon.restore();
    await matchMaker.gracefullyShutdown();
  });

  it('reports this process\' RSS in megabytes, and which process it is', async () => {
    const rss = sinon.stub(process.memoryUsage, 'rss').returns(150 * MB);

    const data = await fetchApi();
    assert.equal(data.memory.rssMb, 150);
    assert.equal(data.memory.processId, matchMaker.processId);

    rss.returns(192.5 * MB);
    assert.equal((await fetchApi()).memory.rssMb, 192.5);
  });

  it('keeps the system memory fields', async () => {
    const { memory } = await fetchApi();
    assert.ok(Object.hasOwn(memory, 'totalMemMb'));
    assert.ok(Object.hasOwn(memory, 'usedMemMb'));
  });
});

import assert from 'node:assert/strict';
import sinon from 'sinon';
import { schema, t } from '@colyseus/schema';
import { createRouter, matchMaker, LocalDriver, LocalPresence, Room } from '@colyseus/core';
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

describe('Monitor room inspect', () => {
  const Drawing = schema({ name: t.string(), png: t.string() });
  const State = schema({ title: t.string(), drawings: t.array(Drawing) });

  class DrawingRoom extends Room {
    state = new State();
    onCreate() {
      this.state.title = 'room';
      this.state.drawings.push(new Drawing({ name: 'small', png: 'x'.repeat(100) }));
      this.state.drawings.push(new Drawing({ name: 'big', png: 'x'.repeat(8 * 1024) }));
    }
  }

  let router: ReturnType<typeof createRouter>;
  let roomId: string;

  const inspect = (query: string) => router
    .handler(new Request(`http://localhost/monitor/api/room?roomId=${roomId}${query}`))
    .then((response) => {
      assert.equal(response.status, 200);
      return response.json();
    });

  beforeEach(async () => {
    await matchMaker.setup(new LocalPresence(), new LocalDriver());
    matchMaker.defineRoomType('drawing', DrawingRoom);
    router = createRouter({ ...monitor() });
    roomId = (await matchMaker.createRoom('drawing', {})).roomId;
  });

  afterEach(async () => {
    await matchMaker.gracefullyShutdown();
  });

  it('omits the state unless asked for it', async () => {
    const data = await inspect('');
    assert.equal(data.state, undefined);
    assert.ok(data.stateSize > 8 * 1024);
  });

  it('replaces large strings and reports their paths', async () => {
    const data = await inspect('&state=1');
    assert.equal(data.state.title, 'room');
    assert.equal(data.state.drawings[0].png, 'x'.repeat(100));
    assert.equal(data.state.drawings[1].png, '‹8.0 KB string, truncated›');
    assert.deepEqual(data.truncated, [JSON.stringify(['drawings', 1, 'png'])]);
  });
});

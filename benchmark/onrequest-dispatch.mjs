// Isolates the ROOM_REQUEST dispatch wrapper changed in RoomMessages.onRequest:
// OLD = Promise.resolve().then(() => handler()).then(onF, onR)
// NEW = run handler in a try; reply synchronously unless it returned a thenable.
//
// Encoding/msgpack/transport work is identical on both paths, so it's excluded
// here to isolate the promise-machinery delta. Reports ops/sec + GC stats.
//
// Run:  node --expose-gc benchmark/onrequest-dispatch.mjs

import { PerformanceObserver } from 'node:perf_hooks';

const OUTCOME_NONE = 0, OUTCOME_REJECTED = 1, OUTCOME_RESOLVED = 2;

class DispatchContext {
  constructor(id) {
    this.id = id;
    this._outcome = OUTCOME_NONE;
    this._reason = undefined;
    this._entity = undefined;
  }
  reject(reason) { this._outcome = OUTCOME_REJECTED; this._reason = reason; }
  resolve(entity) { this._outcome = OUTCOME_RESOLVED; this._entity = entity; }
}

// Mock reply sink — stands in for #replyToRequest -> client.enqueueRaw.
// Identical cost on both paths; just proves the reply was produced.
let replies = 0;
function reply(_requestId, _status, _payload) { replies++; }

function settle(requestId, ctx, response) {
  if (ctx._outcome === OUTCOME_REJECTED) reply(requestId, 'REJECTED', ctx._reason);
  else if (ctx._outcome === OUTCOME_RESOLVED) reply(requestId, 'OK', { ref: 1 });
  else reply(requestId, 'OK', response);
}

// Representative sync handler: reads the message, returns a small object.
const client = { sessionId: 'abc' };
function handler(_client, message, _ctx) {
  return { ok: true, echo: message.n };
}

function dispatchOLD(requestId, message) {
  const ctx = new DispatchContext(requestId);
  return Promise.resolve().then(() => handler(client, message, ctx)).then(
    (response) => settle(requestId, ctx, response),
    (_e) => reply(requestId, 'ERROR', { name: 'Error' }),
  );
}

function dispatchNEW(requestId, message) {
  const ctx = new DispatchContext(requestId);
  let response;
  try {
    response = handler(client, message, ctx);
    if (response !== null && typeof response === 'object' && typeof response.then === 'function') {
      return response.then(
        (resolved) => settle(requestId, ctx, resolved),
        (_e) => reply(requestId, 'ERROR', { name: 'Error' }),
      );
    }
  } catch (_e) {
    reply(requestId, 'ERROR', { name: 'Error' });
    return;
  }
  settle(requestId, ctx, response);
}

// --- GC tracking -----------------------------------------------------------
let gcCount = 0, gcTime = 0;
const obs = new PerformanceObserver((list) => {
  for (const e of list.getEntries()) { gcCount++; gcTime += e.duration; }
});
obs.observe({ entryTypes: ['gc'] });

function resetGC() { gcCount = 0; gcTime = 0; }

// Process in draining batches so the microtask queue empties between them —
// mirrors requests arriving over many I/O ticks, NOT 2M retained at once.
// (Retaining all promises in one Promise.all inflates OLD's heap ~1000x and is
// not representative of real per-request cost.)
const BATCH = 1000;

async function runOLD(n) {
  for (let i = 0; i < n; i += BATCH) {
    const end = Math.min(i + BATCH, n);
    const ps = [];
    for (let j = i; j < end; j++) ps.push(dispatchOLD(j, { n: j }));
    await Promise.all(ps); // drain this batch before the next
  }
}

async function runNEW(n) {
  for (let i = 0; i < n; i += BATCH) {
    const end = Math.min(i + BATCH, n);
    for (let j = i; j < end; j++) dispatchNEW(j, { n: j });
    await Promise.resolve(); // yield symmetrically, even though NEW is sync
  }
}

async function bench(name, fn, n) {
  if (global.gc) global.gc();
  resetGC();
  const memBefore = process.memoryUsage().heapUsed;
  const t0 = process.hrtime.bigint();
  await fn(n);
  const t1 = process.hrtime.bigint();
  const ms = Number(t1 - t0) / 1e6;
  const memAfter = process.memoryUsage().heapUsed;
  const opsSec = (n / ms) * 1000;
  console.log(
    `${name.padEnd(8)} ${n} reqs  ${ms.toFixed(1).padStart(8)} ms  ` +
    `${(opsSec / 1e6).toFixed(2).padStart(6)} M ops/s  ` +
    `GC ${String(gcCount).padStart(4)} ev / ${gcTime.toFixed(1).padStart(7)} ms  ` +
    `heapΔ ${((memAfter - memBefore) / 1e6).toFixed(1).padStart(7)} MB`,
  );
  return { ms, opsSec, gcCount, gcTime };
}

const N = Number(process.argv[2] ?? 2_000_000);

console.log(`\nROOM_REQUEST sync-handler dispatch — ${N.toLocaleString()} requests/run`);
console.log(`gc exposed: ${!!global.gc}\n`);

// warm up both paths (let V8 JIT settle)
await runOLD(50_000); runNEW(50_000); replies = 0;

const results = [];
for (let round = 1; round <= 3; round++) {
  console.log(`round ${round}`);
  results.push(['OLD', await bench('OLD', runOLD, N)]);
  results.push(['NEW', await bench('NEW', runNEW, N)]);
  console.log('');
}

// summary: average the 3 rounds
function avg(name, key) {
  const rs = results.filter(([n]) => n === name).map(([, r]) => r[key]);
  return rs.reduce((a, b) => a + b, 0) / rs.length;
}
const oldOps = avg('OLD', 'opsSec'), newOps = avg('NEW', 'opsSec');
const oldGc = avg('OLD', 'gcTime'), newGc = avg('NEW', 'gcTime');
console.log('--- avg over 3 rounds ---');
console.log(`throughput:  NEW is ${(newOps / oldOps).toFixed(2)}x OLD  (${(oldOps / 1e6).toFixed(2)} -> ${(newOps / 1e6).toFixed(2)} M ops/s)`);
console.log(`GC time:     OLD ${oldGc.toFixed(1)} ms  ->  NEW ${newGc.toFixed(1)} ms  (${oldGc > 0 ? ((1 - newGc / oldGc) * 100).toFixed(0) : 'n/a'}% less)`);
console.log(`replies produced: ${replies.toLocaleString()}\n`);

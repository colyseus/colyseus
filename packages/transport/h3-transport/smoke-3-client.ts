/**
 * Stage 3 client: counts `"refId" not found` decoder errors under spawn churn.
 *
 * Reports rather than asserts a threshold — the point is to measure how often
 * the two channels race in each cadence mode, over real QUIC.
 *
 * Run (server already up): node --experimental-strip-types smoke-3-client.ts
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import { WebTransport } from '@fails-components/webtransport';
(globalThis as any).WebTransport = WebTransport;

import { Client } from '../../sdk/build/index.mjs';

let refIdErrors = 0;
let otherNoise = 0;
const realError = console.error;
const realWarn = console.warn;
console.error = (...args: any[]) => {
  const s = String(args[0]);
  if (s.includes('refId')) { refIdErrors++; return; }
  otherNoise++;
  realError(...args);
};
console.warn = (...args: any[]) => {
  if (String(args[0]).includes('report this issue')) { return; }
  realWarn(...args);
};

function finish(msg: string): never {
  realError(`\n${msg}`);
  process.exit(0);
}
setTimeout(() => { realError('\n❌ TIMEOUT'); process.exit(1); }, 25000);

async function main() {
  const client = new Client('https://localhost:14436', { protocol: 'h3' });
  const room = await client.joinOrCreate('test');
  realError(`• JOINED ${room.sessionId} transport=${(room.connection as any)?.transport?.constructor?.name}`);

  let patches = 0;
  // How often does a live entity's x read as its default (never delivered)?
  let unsetReads = 0;
  let entityReads = 0;

  room.onStateChange((state: any) => {
    patches++;
    state.entities.forEach((e: any) => {
      entityReads++;
      if (e.x === 0) { unsetReads++; }
    });
  });

  realError('• observing spawn churn for 8s ...');
  await new Promise((r) => setTimeout(r, 8000));

  realError(`\n• state updates observed: ${patches}`);
  realError(`• entity reads: ${entityReads}, of which x was still unset: ${unsetReads}`);
  realError(`• "refId not found" decoder errors: ${refIdErrors}`);
  realError(`• other console.error noise: ${otherNoise}`);

  finish(`RESULT refIdErrors=${refIdErrors} unsetReads=${unsetReads}/${entityReads}`);
}

main().catch((e) => { realError(e); process.exit(1); });

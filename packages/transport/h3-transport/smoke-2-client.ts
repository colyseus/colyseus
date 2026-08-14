/**
 * Stage 2 client: verifies `@unreliable` state fields arrive over datagrams,
 * on their own cadence, and stay consistent.
 *
 * Asserts:
 *   1. the transport really is h3 (not a silent ws fallback)
 *   2. the `@unreliable` field updates far more often than the reliable one —
 *      i.e. the two channels run at their own rates
 *   3. the unreliable field is never seen going backwards (the uint16 seq drops
 *      reordered datagrams instead of applying a stale value)
 *   4. no `"refId" not found` decoder errors — a datagram never overtakes the
 *      reliable ADD it depends on
 *
 * Run (with the server already up): node --experimental-strip-types smoke-2-client.ts
 */
// Self-signed matchmake endpoint — accept it (test only).
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// SDK client reads the bare `WebTransport` global — polyfill with the Node impl.
import { WebTransport } from '@fails-components/webtransport';
(globalThis as any).WebTransport = WebTransport;

import { Client } from '../../sdk/build/index.mjs';

// The schema decoder reports an unknown refId on console.error — catch it here
// rather than letting it scroll past as noise.
let decoderErrors = 0;
const originalError = console.error;
console.error = (...args: any[]) => {
  if (String(args[0]).includes('refId')) { decoderErrors++; }
  originalError(...args);
};

function done(ok: boolean, msg: string): never {
  console.log(ok ? `\n✅ STAGE 2 ${msg}` : `\n❌ STAGE 2 ${msg}`);
  process.exit(ok ? 0 : 1);
}
setTimeout(() => done(false, 'TIMEOUT (never joined)'), 20000);

async function main() {
  const client = new Client('https://localhost:14435', { protocol: 'h3' });
  console.log('• joinOrCreate("test") over h3 ...');
  const room = await client.joinOrCreate('test');

  const transportName = (room.connection as any)?.transport?.constructor?.name;
  console.log(`• JOINED. sessionId=${room.sessionId}  transport=${transportName}`);
  if (transportName !== 'H3TransportTransport') {
    done(false, `WRONG TRANSPORT: got ${transportName} (fell back to ws)`);
  }

  const xValues: number[] = [];
  const tickValues: number[] = [];
  let regressions = 0;

  room.onStateChange((state: any) => {
    if (xValues.length === 0 || state.x !== xValues[xValues.length - 1]) {
      if (xValues.length > 0 && state.x < xValues[xValues.length - 1]) { regressions++; }
      xValues.push(state.x);
    }
    if (tickValues.length === 0 || state.tick !== tickValues[tickValues.length - 1]) {
      tickValues.push(state.tick);
    }
  });

  console.log('• observing both channels for 3s ...');
  await new Promise((r) => setTimeout(r, 3000));

  const xUpdates = xValues.length;
  const tickUpdates = tickValues.length;
  console.log(`• unreliable 'x' updates: ${xUpdates}`);
  console.log(`• reliable   'tick' updates: ${tickUpdates}`);
  console.log(`• stale-value regressions: ${regressions}`);
  console.log(`• decoder refId errors: ${decoderErrors}`);

  if (xUpdates === 0) {
    done(false, 'the @unreliable field never arrived — datagram state path is dead');
  }
  if (tickUpdates === 0) {
    done(false, 'the reliable field never arrived');
  }
  // 20ms vs 200ms ⇒ ~10x. Allow generous slack for scheduler jitter and loss.
  if (xUpdates < tickUpdates * 3) {
    done(false, `channels are not independent: x=${xUpdates} vs tick=${tickUpdates} (want x >= 3x tick)`);
  }
  if (regressions > 0) {
    done(false, `${regressions} stale value(s) applied — the seq gate is not dropping reordered frames`);
  }
  if (decoderErrors > 0) {
    done(false, `${decoderErrors} decoder refId error(s)`);
  }

  done(true, `PASSED (x=${xUpdates} unreliable updates vs tick=${tickUpdates} reliable, no regressions)`);
}

main().catch((e) => { originalError(e); done(false, 'ERROR'); });

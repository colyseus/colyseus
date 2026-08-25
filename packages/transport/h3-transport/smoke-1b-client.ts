/**
 * Stage 1b client: real SDK joining over h3 (WebTransport) + sending an
 * unreliable input. Validates finding 2 (protocol now reaches Room.connect →
 * h3 transport selected, not ws) and finding 1 in the full Colyseus path.
 *
 * Run: node --experimental-strip-types smoke-1b-client.ts
 */
// Self-signed matchmake endpoint — accept it (test only).
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// SDK client reads the bare `WebTransport` global — polyfill with the Node impl.
import { WebTransport } from '@fails-components/webtransport';
(globalThis as any).WebTransport = WebTransport;

import { Client } from '../../sdk/build/index.mjs';
import { schema, t, type SchemaType } from '@colyseus/schema';

const Input = schema({ seq: t.number(), x: t.number(), y: t.number() });
type Input = SchemaType<typeof Input>;

function done(ok: boolean, msg: string): never {
  console.log(ok ? `\n✅ STAGE 1b ${msg}` : `\n❌ STAGE 1b ${msg}`);
  process.exit(ok ? 0 : 1);
}
setTimeout(() => done(false, 'TIMEOUT (never joined / sent)'), 15000);

async function main() {
  const client = new Client('https://localhost:14434', { protocol: 'h3' });
  console.log('• joinOrCreate("test") over h3 ...');
  const room = await client.joinOrCreate<Input>('test');

  // Prove which transport actually got selected (finding 2).
  const transportName = (room.connection as any)?.transport?.constructor?.name;
  console.log(`• JOINED. sessionId=${room.sessionId}  transport=${transportName}`);
  if (transportName !== 'H3TransportTransport') {
    done(false, `WRONG TRANSPORT: got ${transportName} (finding 2 not fixed — fell back to ws)`);
  }

  const input = room.input<Input>({ type: Input as any, mode: 'unreliable', seqField: 'seq', historySize: 4 });
  console.log('• sending unreliable inputs over datagrams ...');
  for (let seq = 1; seq <= 10; seq++) {
    input.data.seq = seq;
    input.data.x = seq * 5;
    input.data.y = seq * 7;
    input.send();
    await new Promise((r) => setTimeout(r, 60));
  }

  // Give the server a moment to consume + log.
  await new Promise((r) => setTimeout(r, 800));
  done(true, 'PASSED (joined over h3 + sent unreliable inputs — see server GOT_INPUT lines)');
}

main().catch((e) => { console.error(e); done(false, 'ERROR'); });

/**
 * Stage 4 client: sends unreliable inputs over datagrams to a rewinding room.
 * The server prints one GOT_INPUT line per consumed input; this process only
 * drives the traffic. Assertions live in the runner (smoke-4-run.sh style):
 * every GOT_INPUT must carry reckon>0, including under injected loss.
 *
 * Run (server already up): node --experimental-strip-types smoke-4-client.ts
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import { WebTransport } from '@fails-components/webtransport';
(globalThis as any).WebTransport = WebTransport;

import { Client } from '../../sdk/build/index.mjs';
import { schema, t, type SchemaType } from '@colyseus/schema';

const Input = schema({ seq: t.number(), x: t.number() });
type Input = SchemaType<typeof Input>;

setTimeout(() => { console.log('\n❌ TIMEOUT'); process.exit(1); }, 25000);

async function main() {
  const client = new Client('https://localhost:14437', { protocol: 'h3' });
  const room = await client.joinOrCreate<Input>('test');
  const transportName = (room.connection as any)?.transport?.constructor?.name;
  console.log(`• JOINED ${room.sessionId} transport=${transportName}`);
  if (transportName !== 'H3TransportTransport') {
    console.log(`\n❌ WRONG TRANSPORT: ${transportName}`);
    process.exit(1);
  }

  const input = room.input<Input>({ type: Input as any, mode: 'unreliable', historySize: 4 });

  // Let the clock sync — an unsynced client stamps 0 by design.
  await new Promise((r) => setTimeout(r, 600));

  console.log('• sending 20 unreliable inputs over datagrams ...');
  for (let seq = 1; seq <= 20; seq++) {
    input.data.seq = seq;
    input.data.x = seq * 3;
    input.send();
    await new Promise((r) => setTimeout(r, 40));
  }

  await new Promise((r) => setTimeout(r, 800));
  console.log('• done — see server GOT_INPUT lines');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });

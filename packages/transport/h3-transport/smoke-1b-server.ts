/**
 * Stage 1b server: real Colyseus Server over H3Transport (WebTransport).
 * Validates the full unreliable-input path end-to-end (findings 1 + 2):
 * an unreliable input sent by the SDK over datagrams must reach the Room.
 *
 * Prints "LISTENING <port>" when ready and "GOT_INPUT mode=.. seq=.. x=.. y=.."
 * for each consumed input. The client process watches for these markers.
 *
 * Run: node --experimental-strip-types smoke-1b-server.ts
 */
import express from 'express';
import { Server, Room } from '@colyseus/core';
import { schema, t, type SchemaType } from '@colyseus/schema';
import { H3Transport } from './src/index.ts';

const PORT = 14434;

const State = schema({ tick: t.number() });
type State = SchemaType<typeof State>;

const Input = schema({ seq: t.number(), x: t.number(), y: t.number() });
type Input = SchemaType<typeof Input>;

class TestRoom extends Room<{ state: State; input: Input }> {
  state = new State();
  // No seqField — the framework seq now dedupes the unreliable ring automatically.
  inputs = this.defineInput(Input, { bufferMaxSize: 64 });

  onCreate() {
    console.log('ROOM_CREATED');
    this.setFixedTimestep(() => {
      for (const client of this.clients) {
        for (const inp of this.inputs.get(client.sessionId)) {
          console.log(`GOT_INPUT mode=unreliable seq=${inp.seq} x=${inp.x} y=${inp.y}`);
        }
      }
    }, 20);
  }

  onJoin(client: any) { console.log(`JOINED ${client.sessionId}`); }
}

async function main() {
  const app = express();
  const gameServer = new Server({ transport: new H3Transport({ app }) });
  gameServer.define('test', TestRoom);
  await gameServer.listen(PORT);
  console.log(`LISTENING ${PORT}`);
}

main().catch((e) => { console.error('SERVER_FAILED', e); process.exit(1); });

/**
 * Stage 2 server: `@unreliable` state fields over WebTransport datagrams.
 *
 * The room runs a slow reliable patch (200ms) and a fast unreliable one (20ms),
 * mutating both a plain field and an `@unreliable` field on every sim tick. If
 * the two channels are really independent, the client sees the unreliable field
 * update ~10x more often than the reliable one.
 *
 * Prints "LISTENING <port>". The client process watches for it.
 *
 * Run: node --experimental-strip-types smoke-2-server.ts
 */
import express from 'express';
import { Server, Room } from '@colyseus/core';
import { schema, t, type SchemaType } from '@colyseus/schema';
import { H3Transport } from './src/index.ts';

const PORT = 14435;

const State = schema({
  // Reliable: rides the ordered stream at `patchRate`.
  tick: t.number().default(0),
  // Unreliable: rides datagrams at `unreliablePatchRate`.
  x: t.number().default(0).unreliable(),
});
type State = SchemaType<typeof State>;

class TestRoom extends Room<{ state: State }> {
  state = new State();

  patchRate = 200;            // reliable: 5Hz
  unreliablePatchRate = 20;   // unreliable: 50Hz

  onCreate() {
    console.log('ROOM_CREATED');
    this.setSimulationInterval(() => {
      this.state.tick++;
      this.state.x = this.state.tick * 2;
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

/**
 * Stage 4 server: lag-comp stamps on UNRELIABLE inputs, over real datagrams.
 *
 * A reckon-mode rewind group makes the server ask clients to stamp. Each
 * consumed input's reckon instant is printed so the client can assert that
 * every one arrived stamped — including inputs recovered from the redundancy
 * ring after their own datagram was dropped.
 *
 * H3_DATAGRAM_LOSS=<0..1> drops incoming datagrams to force that recovery.
 *
 * Run: node --experimental-strip-types smoke-4-server.ts
 */
import express from 'express';
import { Server, Room } from '@colyseus/core';
import { schema, t, MapSchema, type SchemaType } from '@colyseus/schema';
import { H3Transport } from './src/index.ts';

const PORT = 14437;

const Input = schema({ seq: t.number(), x: t.number() });
type Input = SchemaType<typeof Input>;

const Enemy = schema({ x: t.number().default(0) });
type Enemy = SchemaType<typeof Enemy>;

const State = schema({
  tick: t.number().default(0),
  enemies: t.map(Enemy).default(new MapSchema<Enemy>()),
});
type State = SchemaType<typeof State>;

class TestRoom extends Room<{ state: State; input: Input }> {
  state = new State();
  inputs = this.defineInput(Input, { bufferMaxSize: 64 });
  rewind = this.allowRewindState({ maxRewindMs: 1000 });

  onCreate() {
    this.state.enemies.set("a", new Enemy());
    this.rewind.attachAll(this.state.enemies, { fields: ["x"], mode: "reckon" });
    console.log('ROOM_CREATED');

    this.setSimulationInterval(() => {
      this.state.tick++;
      this.state.enemies.get("a")!.x += 1;
      for (const client of this.clients) {
        const ch = this.inputs.get(client.sessionId);
        let inp = ch.next();
        while (inp !== undefined) {
          const reckon = (client as any)._inputBuffer.reckonTime;
          console.log(`GOT_INPUT seq=${(inp as any).seq} reckon=${reckon}`);
          inp = ch.next();
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

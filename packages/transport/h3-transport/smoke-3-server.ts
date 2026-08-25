/**
 * Stage 3 server: spawn/despawn churn while `@unreliable` fields stream.
 *
 * Exercises the one ordering hazard of the two-channel split — an entity's ADD
 * travels the reliable stream while its `@unreliable` fields travel datagrams,
 * so a datagram can reference a refId the client hasn't been told about yet.
 *
 * UNRELIABLE_RATE=<ms|inline> picks the cadence under test:
 *   inline (default) — flush with each broadcastPatch (ADD ships first, same tick)
 *   <ms>             — dedicated timer, i.e. datagrams between reliable patches
 *
 * Run: node --experimental-strip-types smoke-3-server.ts
 */
import express from 'express';
import { Server, Room } from '@colyseus/core';
import { schema, t, MapSchema, type SchemaType } from '@colyseus/schema';
import { H3Transport } from './src/index.ts';

const PORT = 14436;
const MODE = process.env.UNRELIABLE_RATE ?? 'inline';

const Entity = schema({
  name: t.string(),
  x: t.number().default(0).unreliable(),
});
type Entity = SchemaType<typeof Entity>;

const State = schema({
  entities: t.map(Entity).default(new MapSchema<Entity>()),
});
type State = SchemaType<typeof State>;

class TestRoom extends Room<{ state: State }> {
  state = new State();
  patchRate = 200;

  #n = 0;

  onCreate() {
    if (MODE !== 'inline') { this.unreliablePatchRate = Number(MODE); }
    console.log(`ROOM_CREATED mode=${MODE} patchRate=${this.patchRate}`);

    // Spawn a new entity every 100ms and drop the oldest — constant churn, so
    // ADDs and DELETEs keep interleaving with the datagram stream.
    this.setSimulationInterval(() => {
      const key = `e${this.#n++}`;
      const e = new Entity();
      e.name = key;
      e.x = 1;
      this.state.entities.set(key, e);

      if (this.state.entities.size > 5) {
        const oldest = this.state.entities.keys().next().value;
        this.state.entities.delete(oldest as string);
      }

      // Keep every live entity's unreliable field moving.
      this.state.entities.forEach((ent) => { ent.x += 1; });
    }, 100);
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

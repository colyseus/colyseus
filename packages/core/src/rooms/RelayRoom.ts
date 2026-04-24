import { CloseCode } from '@colyseus/shared-types';
import { schema, t, type SchemaType } from '@colyseus/schema';

import { Room } from '../Room.ts';
import type { Client } from '../Transport.ts';

export const Player = schema({
  connected: t.boolean(),
  name: t.string(),
  sessionId: t.string(),
});
export type Player = SchemaType<typeof Player>;

export const State = schema({
  players: t.map(Player),
});
export type State = SchemaType<typeof State>;

/**
 * client.joinOrCreate("relayroom", {
 *   maxClients: 10,
 *   allowReconnectionTime: 20
 * });
 */

export class RelayRoom extends Room {
  public state = new State();
  public allowReconnectionTime: number = 0;

  public onCreate(options: Partial<{
    maxClients: number,
    allowReconnectionTime: number,
    metadata: any,
  }>) {
    if (options.maxClients) {
      this.maxClients = options.maxClients;
    }

    if (options.allowReconnectionTime) {
      this.allowReconnectionTime = Math.min(options.allowReconnectionTime, 40);
    }

    if (options.metadata) {
      this.setMetadata(options.metadata);
    }

    this.onMessage('*', (client: Client, type: string | number, message: any) => {
      this.broadcast(type, [client.sessionId, message], { except: client });
    });
  }

  public onJoin(client: Client, options: any = {}) {
    const player = new Player();

    player.connected = true;
    player.sessionId = client.sessionId;

    if (options.name) {
      player.name = options.name;
    }

    this.state.players.set(client.sessionId, player);
  }

  public async onLeave(client: Client, code: number) {
    if (this.allowReconnectionTime > 0) {
      const player = this.state.players.get(client.sessionId);
      player.connected = false;

      try {
        if (code === CloseCode.CONSENTED) {
          throw new Error('consented leave');
        }

        await this.allowReconnection(client, this.allowReconnectionTime);
        player.connected = true;

      } catch (e) {
        this.state.players.delete(client.sessionId);
      }
    }
  }

}

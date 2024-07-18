import { defineTypes, MapSchema, Schema } from '@colyseus/schema';

import { Room } from '../Room.js';
import { Client } from '../Transport.js';

class Player extends Schema { // tslint:disable-line
  public connected: boolean;
  public name: string;
  public sessionId: string;
}
defineTypes(Player, {
  connected: 'boolean',
  name: 'string',
  sessionId: 'string',
});

class State extends Schema { // tslint:disable-line
  public players = new MapSchema<Player>();
}
defineTypes(State, {
  players: { map: Player },
});

/**
 * client.joinOrCreate("relayroom", {
 *   maxClients: 10,
 *   allowReconnectionTime: 20
 * });
 */

export class RelayRoom extends Room<State> { // tslint:disable-line
  public allowReconnectionTime: number = 0;

  public onCreate(options: Partial<{
    maxClients: number,
    allowReconnectionTime: number,
    metadata: any,
  }>) {
    this.setState(new State());

    if (options.maxClients) {
      this.maxClients = options.maxClients;
    }

    if (options.allowReconnectionTime) {
      this.allowReconnectionTime = Math.min(options.allowReconnectionTime, 40);
    }

    if (options.metadata) {
      this.setMetadata(options.metadata);
    }

    this.onMessage('*', (client: Client, type: string, message: any) => {
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

  public async onLeave(client: Client, consented: boolean) {
    if (this.allowReconnectionTime > 0) {
      const player = this.state.players.get(client.sessionId);
      player.connected = false;

      try {
        if (consented) {
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

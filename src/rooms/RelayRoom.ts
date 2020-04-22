import { Context, defineTypes, MapSchema, Schema } from '@colyseus/schema';

import { Room } from '../Room';
import { Client } from '../transport/Transport';

/**
 * Create another context to avoid these types from being in the user's global `Context`
 */
const context = new Context();

class Player extends Schema { // tslint:disable-line
  public connected: boolean;
  public name: boolean;
  public sessionId: string;
}
defineTypes(Player, {
  connected: 'boolean',
  name: 'string',
  sessionId: 'string',
}, context);

class State extends Schema { // tslint:disable-line
  public players = new MapSchema<Player>();
}
defineTypes(State, {
  players: { map: Player },
}, context);

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

    this.state.players[client.sessionId] = player;
  }

  public async onLeave(client: Client, consented: boolean) {
    if (this.allowReconnectionTime > 0) {
      this.state.players[client.sessionId].connected = false;

      try {
        if (consented) {
          throw new Error('consented leave');
        }

        await this.allowReconnection(client, this.allowReconnectionTime);
        this.state.players[client.sessionId].connected = true;

      } catch (e) {
        delete this.state.players[client.sessionId];
      }
    }
  }

}

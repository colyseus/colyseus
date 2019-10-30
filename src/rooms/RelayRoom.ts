import { MapSchema, Schema, type, Context, defineTypes } from '@colyseus/schema';

import { Client } from '..';
import { Room } from '../Room';

/**
 * Create another context to avoid these types from being in the user's global `Context`
 */
const context = new Context();

class Player extends Schema { // tslint:disable-line
  public sessionId: string;
  public connected: boolean;
}
defineTypes(Player, {
  sessionId: "string",
  connected: "boolean"
}, context);

class State extends Schema { // tslint:disable-line
  public players = new MapSchema<Player>();
}
defineTypes(State, {
  players: { map: Player }
}, context);

/**
 * client.joinOrCreate("relayroom", {
 *   maxClients: 10,
 *   allowReconnectionTime: 20
 * });
 */

export class RelayRoom extends Room<State> { // tslint:disable-line
  public allowReconnectionTime: number = 0;

  public onCreate(options) {
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
  }

  public onJoin(client: Client, options: any) {
    const player = new Player();
    player.sessionId = client.sessionId;
    player.connected = true;

    this.state.players[client.sessionId] = player;
  }

  public onMessage(client: Client, message: any) {
    /**
     * append `sessionId` into the message for broadcast.
     */
    if (typeof(message) === 'object' && !Array.isArray(message)) {
      message.sessionId = client.sessionId;
    }

    this.broadcast(message, { except: client });
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

import { MapSchema, Schema, type } from '@colyseus/schema';

import { Client } from '..';
import { Room } from '../Room';

class Player extends Schema {
  @type('string') public sessionId: string;
  @type('boolean') public connected: boolean;
  @type('boolean') public isMaster: boolean;
}

class State extends Schema {
  @type({ map: Player })
  public players = new MapSchema<Player>();
}

/**
 * client.joinOrCreate("relayroom", {
 *   maxClients: 10,
 *   allowReconnectionTime: 20
 * });
 */

export class RelayRoom extends Room<State> {
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

    // first player joining is assigned as master
    player.isMaster = (this.clients.length === 1);

    this.state.players[client.sessionId] = player;
  }

  public onMessage(client: Client, message: any) {
    /**
     * append `sessionId` into the message for broadcast.
     */
    if (typeof(message) === "object" && !Array.isArray(message)) {
      message.sessionId = client.sessionId;
    }

    this.broadcast(message, { except: client });
  }

  public async onLeave(client: Client, consented: boolean) {
    // master is leaving, let's assign a new master.
    if (this.state.players[client.sessionId].isMaster) {
      const availableSessionIds = Object.keys(this.state.players).filter((sessionId) => sessionId !== client.sessionId);
      if (availableSessionIds.length > 0) {
        const newMasterSessionId = availableSessionIds[Math.floor(Math.random() * availableSessionIds.length)];
        this.state.players[newMasterSessionId].isMaster = true;
      }
    }

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

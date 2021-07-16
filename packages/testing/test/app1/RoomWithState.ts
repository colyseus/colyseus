import { Client, Room } from "@colyseus/core";
import { MapSchema, Schema, type } from "@colyseus/schema";

export class Player extends Schema {
  @type("number") playerNum: number;
  @type("number") score: number;
}

export class State extends Schema {
  @type({ map: Player }) players = new MapSchema<Player>();
}

export class RoomWithState extends Room<State> {

  onCreate(options) {
    this.setState(new State());

    this.onMessage("mutate", (client, message) => {
      const player = this.state.players.get(client.sessionId);
      player.score++;
    });

    this.onMessage("chat", (client, message) =>
      this.broadcast("chat", [client.sessionId, message]));
  }

  onJoin(client: Client, message: any) {
    const player = new Player();
    player.playerNum = this.clients.length;
    player.score = 0;

    this.state.players.set(client.sessionId, player);
  }

  onLeave(client: Client) {
    this.state.players.delete(client.sessionId);
  }

}
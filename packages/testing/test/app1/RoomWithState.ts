import { Client, Room } from "@colyseus/core";
import { MapSchema, Schema, type } from "@colyseus/schema";

export class State extends Schema {
  @type({ map: "number" }) players = new MapSchema<number>();
}

export class RoomWithState extends Room<State> {

  onCreate(options) {
    this.setState(new State());

    this.onMessage("chat", (client, message) =>
      this.broadcast("chat", [client.sessionId, message]));
  }

  onJoin(client: Client, message: any) {
    this.state.players.set(client.sessionId, 0);
  }

  onLeave(client: Client) {
    this.state.players.delete(client.sessionId);
  }

}
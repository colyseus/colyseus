import { Room } from "@colyseus/core";

export class RoomWithoutState extends Room {
  maxClients = 2;

  onCreate(options) {
    this.onMessage("one-ping", (client, message) =>
      client.send("one-pong", ['one', message]));

    this.onMessage("two-ping", (client, message) =>
      client.send("two-pong", ['two', message]));

    this.onMessage("broadcast", (client, message) =>
      this.broadcast("to-all", [client.sessionId, message]));
  }

}
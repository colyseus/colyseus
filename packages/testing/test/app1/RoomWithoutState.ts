import { Room, type Client } from "@colyseus/core";

export class RoomWithoutState extends Room {
  maxClients = 2;

  messages = {
    "one-ping": (client: Client, message) =>
      client.send("one-pong", ['one', message]),

    "two-ping": (client: Client, message) =>
      client.send("two-pong", ['two', message]),

    "broadcast": (client: Client, message) =>
      this.broadcast("to-all", [client.sessionId, message]),
  };

}
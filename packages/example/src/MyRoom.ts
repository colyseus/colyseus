import { Room, Client, ClientArray } from "@colyseus/core";
import { Schema, type, MapSchema } from "@colyseus/schema";
import { IncomingMessage } from "http";

export class Player extends Schema {
  @type("number") x: number;
  @type("number") y: number;
}

export class MyRoomState extends Schema {
  @type("number") mapWidth: number;
  @type("number") mapHeight: number;
  @type({ map: Player }) players = new MapSchema<Player>();
}

export class MyRoom extends Room<MyRoomState> {
  players: { [sessionId: string]: any } = {};

  onCreate(options: any) {
    this.setState(new MyRoomState());

    // map dimensions
    this.state.mapWidth = 800;
    this.state.mapHeight = 600;

    this.onMessage("*", (client, type, message) => {
      client.send(type, message);
    });

    this.setSimulationInterval(() => this.update());
  }

  update() {
    this.state.players.forEach((player, key) => {
      player.x += 1;
      player.y += 1;
    });
  }

  onJoin(client: Client, options: any) {
    console.log(client.sessionId, "joined! options =>", options);

    const player = new Player();
    player.x = Math.random() * this.state.mapWidth;
    player.y = Math.random() * this.state.mapHeight;

    this.state.players.set(client.sessionId, player);
  }

  onLeave(client: Client, consented: boolean) {
    console.log(client.sessionId, "left!");
    this.state.players.delete(client.sessionId);
  }

  onCacheRoom() {
    return { hello: true };
  }

  onRestoreRoom(cached: any): void {
    console.log("ROOM HAS BEEN RESTORED!", cached);
  }

  onDispose() {
    console.log("room", this.roomId, "disposing...");
  }

}
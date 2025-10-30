import { Room, type Client } from "@colyseus/core";
import { schema } from "@colyseus/schema";

export const Player = schema({
  x: "number",
  y: "number",
});

export const MyRoomState = schema({
  mapWidth: "number",
  mapHeight: "number",
  players: { map: Player },
});

export class MyRoom extends Room {
  state = new MyRoomState();

  messages = {
    move: (client: Client, message: { x: number, y: number }) => {
      const player = this.state.players.get(client.sessionId);
      player.x = message.x;
      player.y = message.y;
    },

    nopayload: (client: Client) => {},
  };

  onCreate(options: any) {
    // map dimensions
    this.state.mapWidth = 800;
    this.state.mapHeight = 600;

    this.onMessage("*", (client, type, message) => {
      console.log("received", { type, message });
      // client.send(type, message);
    });

    this.onMessage("move", (client, message) => {
      const player = this.state.players.get(client.sessionId);
      player.x = message.x;
      player.y = message.y;
    })

    this.setSimulationInterval(() => this.update());
  }

  onJoin(client: Client, options: any) {
    console.log(client.sessionId, "joined! options =>", options);

    const player = new Player();
    player.x = Math.random() * this.state.mapWidth;
    player.y = Math.random() * this.state.mapHeight;

    this.state.players.set(client.sessionId, player);
  }


  update() {
    // this.state.players.forEach((player, key) => {
    //   player.x += 1;
    //   player.y += 1;
    // });
  }

  async onLeave(client: Client, consented: boolean) {
    try {
      if (consented) { throw new Error("consented leave"); }

      console.log(client.sessionId, "waiting for reconnection...");
      await this.allowReconnection(client, 10);

      console.log(client.sessionId, "reconnected!");

    } catch (e) {
      this.state.players.delete(client.sessionId);
      console.log(client.sessionId, "left!");
    }
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
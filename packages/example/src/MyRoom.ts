import { CloseCode, Room, type Client, validate, type Messages, type AuthContext } from "@colyseus/core";
import { schema, type SchemaType, MapSchema } from "@colyseus/schema";
import { z } from "zod";

export const Player = schema({
  x: "number",
  y: "number",
});
export type Player = SchemaType<typeof Player>;

export const MyRoomState = schema({
  mapWidth: "number",
  mapHeight: "number",
  players: { map: Player },
});
export type MyRoomState = SchemaType<typeof MyRoomState>;

const thirdPartyMessages: Messages<MyRoom> = {
  nopayload: function (client: MyClient, message: any) {
    this.broadcast("hello", {});
    client.send("hello", {});
  },

  with_validation: validate(z.object({
    name: z.string(),
  }), function (client: MyClient, message: any) {
    this.broadcast("obj_message", { message: "hello" });
    client.send("obj_message", { message: "hello" })
  }),

  // _ and * are equivalent (fallback handlers)
  // we're using both just to check types
  _: function (client: MyClient, type: string, message: any) {
    this.broadcast("hello", {});
  },
  // // _ and * are equivalent (fallback handlers)
  // // we're using both just to check types
  // '*': function (client: MyClient, type: string, message: any) {
  //   this.broadcast("hello", {});
  // },
}

type MyClient = Client<{
  userData: { custom: boolean };
  auth: { custom: boolean };
  messages: {
    nopayload: never;
    message: any;
    nopayload_2: any;
    obj_message: { message: string };
    hello: any;
  };
}>;

export class MyRoom extends Room<{ state: MyRoomState, client: MyClient }> {
  state = new MyRoomState();

  messages = {
    ...thirdPartyMessages,
    move: validate(z.object({
      x: z.number(),
      y: z.number(),
      z: z.number().optional()
    }), (client, message) => {
      const player = this.state.players.get(client.sessionId)!;
      player.x = message.x;
      player.y = message.y;
    }),

    nopayload_2: (client: MyClient, message: any) => {
      client.send("obj_message", { message: "hello" })
      this.broadcast("obj_message", { message: "hello" })
    },

    _: (client: MyClient, type: string, message: any) => {
      this.broadcast(type as any, message);
    },
  };

  onCreate(options: any) {
    this.seatReservationTimeout = 30;

    // map dimensions
    this.state.mapWidth = 800;
    this.state.mapHeight = 600;

    this.onMessage("__move", (client, message) => {})
    this.onMessage("__dummy", (client, message) => { })

    this.onMessage("move_with_validation", z.object({ x: z.number(), y: z.number() }), (client, message) => {
      const player = this.state.players.get(client.sessionId)!;
      player.x = message.x;
      player.y = message.y;
    });

    this.setSimulationInterval(() => this.update());
  }

  // onJoin(client: Client<{ custom: boolean }, { custom: boolean }>, options: any) {
  onJoin(client: MyClient, options: any) {
    console.log(client.sessionId, "joined! options =>", options);

    const player = new Player();
    player.x = Math.random() * this.state.mapWidth;
    player.y = Math.random() * this.state.mapHeight;

    this.state.players.set(client.sessionId, player);
  }

  public onReconnect(client: MyClient): void | Promise<any> {
    console.log(client.sessionId, "reconnected!");
  }

  update() {
    // this.state.players.forEach((player, key) => {
    //   player.x += 1;
    //   player.y += 1;
    // });
  }

  async onLeave(client, code: number) {
    try {
      if (code === CloseCode.CONSENTED) { throw new Error("consented leave"); }

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
    console.log("onRestoreRoom", cached);
  }

  onDispose() {
    console.log("room", this.roomId, "disposing...");
  }

  onBeforeShutdown() {
    //
    // Disconnect all clients after 30 seconds
    //
    this.clock.setTimeout(() => this.disconnect(), 5 * 1000);
  }

}

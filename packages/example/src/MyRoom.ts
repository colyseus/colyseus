import { CloseCode, Room, type Client, validate, type Messages, type AuthContext, definePlugins } from "@colyseus/core";
import { schema, t, type SchemaType } from "@colyseus/schema";
import { AnalyticsPlugin, CloudSavesPlugin, LeaderboardsPlugin } from "@colyseus/database";
import { z } from "zod";
import { database } from "./db/database.ts";

const VERSION = 5;

export const Player = schema({
  x: t.number(),
  y: t.number(),
  score: t.number(),
});
export type Player = SchemaType<typeof Player>;

export const MyRoomState = schema({
  mapWidth: t.number(),
  mapHeight: t.number(),
  players: t.map(Player),
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

const Input = schema({
  seq: t.number(),
  x: t.number(),
  y: t.number(),
});
type Input = SchemaType<typeof Input>;

export class MyRoom extends Room<{ state: MyRoomState, client: MyClient, input: Input }> {
  state = new MyRoomState();

  // Database-driven plugins — one instance per room. The framework
  // walks this record at __init, computes the lifecycle/message layout
  // ONCE per Room class (cached on the constructor), and installs hook
  // wrappers on the prototype. Subsequent constructs of MyRoom reuse
  // the cached layout. Public methods are reachable as
  // `this.plugins.<key>.<method>(...)` with full types.
  plugins = definePlugins({
    analytics: new AnalyticsPlugin({ database, prefix: 'my_room' }),
    saves: new CloudSavesPlugin<this>({
      database,
      slot: 0,
      payload: (room, client) => {
        const player = room.state.players.get(client.sessionId);
        return player ? { x: player.x, y: player.y, score: player.score } : null;
      },
      apply: (room, client, data) => {
        const player = room.state.players.get(client.sessionId);
        if (!player || !data) return;
        const d = data as { x: number; y: number; score: number };
        player.x = d.x;
        player.y = d.y;
        player.score = d.score;
      },
    }),
    ranked: new LeaderboardsPlugin<this>({
      database,
      boardId: 'my_room_score',
      boardName: 'MyRoom Score',
      score: (room, client) => room.state.players.get(client.sessionId)?.score ?? null,
    }),
  });

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
      console.log("MOVE", { sessionId: client.sessionId, VERSION });
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
    this.seatReservationTimeout = 31;

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

  onJoin(client: MyClient, options: any) {
    const player = new Player();
    player.x = Math.random() * this.state.mapWidth;
    player.y = Math.random() * this.state.mapHeight;
    this.state.players.set(client.sessionId, player);
    console.log("ON JOIN", { VERSION });
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
    // Disconnect all clients after 5 seconds
    //
    this.clock.setTimeout(() => this.disconnect(), 5 * 1000);
  }

}

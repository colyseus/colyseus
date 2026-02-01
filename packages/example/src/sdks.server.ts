process.env.JWT_SECRET = "test"; // use .env instead.

import { type Client, createEndpoint, createRouter, defineRoom, defineServer, generateId, LobbyRoom, QueueRoom, Room } from "@colyseus/core";
import { auth } from "@colyseus/auth";
import { MapSchema, Schema, type } from "@colyseus/schema";
import { playground } from "@colyseus/playground";
import { monitor } from "@colyseus/monitor";

/**
 * Auth Module Configuration
 * --------------------------
 */
const fakeDb: any[] = [];
auth.settings.onFindUserByEmail = async (email) => {
  const userFound = fakeDb.find((user) => user.email === email);;
  console.log("onFindUserByEmail", userFound);
  // return a copy of the user object
  return userFound && JSON.parse(JSON.stringify(userFound));
};
auth.settings.onRegisterWithEmailAndPassword = async (email, password) => {
  const user = { email, password, name: email.split("@")[0], errorServerIsStringButClientIsInt: "this should not crash the client", someAdditionalData: true, };
  fakeDb.push(JSON.parse(JSON.stringify(user))); // keep a copy of the user object
  return user;
};
auth.settings.onRegisterAnonymously = async (options) => {
  return { anonymousId: Math.round(Math.random() * 1000), anonymous: true, ...options };
};

/**
 * HTTP Routes
 * ----------------
 */
const testEndpoint = createEndpoint("/test", { method: "GET" }, async (ctx) => {
  return { things: [1, 2, 3, 4, 5, 6] };
})

/**
 * Room State
 * ----------------
 */
class Item extends Schema {
  @type("string") name?: string;
  @type("number") value?: number;
}

class Player extends Schema {
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("boolean") isBot?: boolean;
  @type("boolean") disconnected?: boolean;
  @type([Item]) items: Item[] = [];
}

class MyRoomState extends Schema {
  @type({ map: Player }) players = new MapSchema<Player>();
  @type(Player) host?: Player;
  @type("string") currentTurn?: string;
}

/**
 * Room definition
 * ----------------
 */
export class MyRoom extends Room {
  state = new MyRoomState();

  messages = {
    move: (client: Client, message: { x: number, y: number }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;

      player.x = message.x;
      player.y = message.y;
    },
    add_item: (client: Client, message: { name: string }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;

      player.items.push(new Item().assign({ name: message.name }));
    },
    remove_item: (client: Client) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      if (player.items.length === 0) return;

      const randomIndex = Math.floor(Math.random() * player.items.length);
      player.items.splice(randomIndex, 1);
    },
    add_bot: (client: Client) => {
      const botId = generateId();
      this.state.players.set(botId, new Player().assign({
        isBot: true,
        x: Math.random() * 800,
        y: Math.random() * 600,
      }));
    },
    remove_bot: (client: Client, message: { name: string }) => {
      const bot = this.state.players.entries().find(([_, player]) => player.isBot)
      if (bot) {
        this.state.players.delete(bot[0]);
      }
    },
  }

  onCreate() {
    // broadcast "weather" event every 4 seconds
    this.clock.setInterval(() => {
      const weather = ["sunny", "cloudy", "rainy", "snowy"];
      this.broadcast("weather", { weather: weather[Math.floor(Math.random() * weather.length)] });
    }, 4000);
  }

  onJoin(client: Client) {
    const player = new Player();
    player.items.push(new Item().assign({ name: "sword" }));

    if (!this.state.host) {
      this.state.host = player;
      this.state.currentTurn = client.sessionId;
    }

    this.state.players.set(client.sessionId, player);

    // advance turn every 2 seconds
    this.clock.setInterval(() => {
      const sessionIds = Array.from(this.state.players.keys());
      const nextSessionId = sessionIds.find(sessionId => sessionId === this.state.currentTurn);
      this.state.currentTurn = nextSessionId;
    }, 2000);

    // move bots
    this.setSimulationInterval(() => {
      this.state.players.forEach(player => {
        if (player.isBot) {
          player.x += Math.random() * 10 - 5;
          player.y += Math.random() * 10 - 5;
        }
      });
    });
  }

  async onDrop(client: Client) {
    const player = this.state.players.get(client.sessionId);
    if (player) {
      player.disconnected = true;
    }
    await this.allowReconnection(client, 10);
  }

  onReconnect(client: Client) {
    const player = this.state.players.get(client.sessionId);
    if (player) {
      player.disconnected = false;
    }
  }

  onLeave(client: Client, code?: number) {
    const player = this.state.players.get(client.sessionId);
    if (player) {
      this.state.players.delete(client.sessionId);

      // if the player is the host, assign a new host
      if (this.state.host === player && this.state.players.size > 0) {
        this.state.host = this.state.players.values().next().value;
      }
    }
  }
}

/**
 * Colyseus Server
 * ----------------
 */
const server = defineServer({
  rooms: {
    my_room: defineRoom(MyRoom).enableRealtimeListing(),
    lobby: defineRoom(LobbyRoom),
    queue: defineRoom(QueueRoom, {
      matchRoomName: "my_room",
      maxPlayers: 4
    }),
  },

  express: (app) => {
    app.use(auth.prefix, auth.routes());
    app.use("/", playground());
    app.use("/monitor", monitor());
  },

  routes: createRouter({
    testEndpoint,
  })
});

server.listen(2567).then(() => {
  console.log("⚔️ Listening on port http://localhost:2567");
}).catch((err) => {
  console.error("❌ Error listening on port 2567", err);
});
import config from "@colyseus/tools";
import { defineRoom } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";

// import { MongooseDriver } from "@colyseus/mongoose-driver";
// import { RedisPresence } from "@colyseus/redis-presence";

import { RoomWithoutState } from "./RoomWithoutState.ts";
import { RoomWithState } from "./RoomWithState.ts";
import { RoomWithSimulation } from "./RoomWithSimulation.ts";
import { auth, Hash } from "@colyseus/auth";

export default config({
  rooms: {
    room_without_state: defineRoom(RoomWithoutState),
    room_with_state: defineRoom(RoomWithState),
    room_with_simulation: defineRoom(RoomWithSimulation),
  },

  options: { greet: false, },

  // options: {
  //   driver: new MongooseDriver(),
  //   presence: new RedisPresence(),
  // },

  initializeTransport: (options) => new WebSocketTransport(options),

  initializeGameServer: (gameServer) => {
    // ...
  },

  initializeExpress: (app) => {
    app.get("/something", (req, res) => {
      res.setHeader("header-one", 1);
      res.json({ success: true });
    });
    app.use(auth.prefix, auth.routes({
      async onFindUserByEmail() {
        return { name: "name", password: await Hash.make("password")}
      },

      async onRegisterWithEmailAndPassword(email, password) {
        return { name: "name", password: await Hash.make("password")}
      },
    }))
  },

})

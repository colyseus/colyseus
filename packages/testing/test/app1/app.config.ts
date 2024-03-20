import config from "@colyseus/tools";
import { WebSocketTransport } from "@colyseus/ws-transport";

import { MongooseDriver } from "@colyseus/mongoose-driver";
import { RedisPresence } from "@colyseus/redis-presence";

import { RoomWithoutState } from "./RoomWithoutState";
import { RoomWithState } from "./RoomWithState";
import { RoomWithSimulation } from "./RoomWithSimulation";
import {auth, Hash} from "../../../auth";

export default config({
  options: { greet: false, },

  // options: {
  //   driver: new MongooseDriver(),
  //   presence: new RedisPresence(),
  // },

  initializeTransport: (options) => new WebSocketTransport(options),

  initializeGameServer: (gameServer) => {
    gameServer.define("room_without_state", RoomWithoutState);
    gameServer.define("room_with_state", RoomWithState);
    gameServer.define("room_with_simulation", RoomWithSimulation);
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

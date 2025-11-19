process.env.JWT_SECRET = "test";
process.env.SESSION_SECRET = "SESSION_SECRET";

import config, { listen } from "@colyseus/tools";
import { createEndpoint, createRouter, defineRoom, matchMaker } from "@colyseus/core";
import { PostgresDriver } from "@colyseus/drizzle-driver";
import { playground } from "@colyseus/playground";
import { auth } from "@colyseus/auth";

// import { Client } from "@colyseus/sdk";
// const client = new Client<typeof server>("ws://localhost:2567");

import { MyRoom } from "./MyRoom.ts";

auth.oauth.addProvider("discord", {
  key: "799645393566695465",
  secret: "Kjv9bvAa9ZRBe8LBM5ZJ6bJsH0o44HdT",
  scope: ["identify", "email"]
})

const listThings = createEndpoint("/things", { method: "GET" }, async (ctx) => {
  return { things: [1, 2, 3, 4, 5, 6] };
})

const server = config({
  options: {
    driver: new PostgresDriver(),
  },

  rooms: {
    my_room: defineRoom(MyRoom),
  },

  routes: createRouter({ listThings }, {
    onError: (err) => {
      console.log(err);
    },
    onRequest: (req) => {
      console.log(req);
    },
    onResponse: (res) => {
      console.log(res);
    },
  }),

  initializeExpress: (app) => {
    app.use("/", playground());
    app.get("/express", (_, res) => res.json({ message: "Hello World" }));
    app.use(auth.prefix, auth.routes({}));
  },

  beforeListen: async () => {
    await matchMaker.createRoom("my_room", {});
  }
})

listen(server);
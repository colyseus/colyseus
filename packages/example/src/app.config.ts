import config, { listen } from "@colyseus/tools";
import { createEndpoint, createRouter, defineRoom } from "@colyseus/core";
import { DrizzleDriver } from "@colyseus/drizzle-driver";
import { playground } from "@colyseus/playground";

// import { Client } from "@colyseus/sdk";

import { MyRoom } from "./MyRoom.ts";

const listThings = createEndpoint("/things", { method: "GET" }, async (ctx) => {
  return { things: [1, 2, 3, 4, 5, 6] };
})

const server = config({
  options: {
    driver: new DrizzleDriver(),
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
    // app.get("/", (_, res) => res.json({ message: "Hello World" }));
    app.get("/express", (_, res) => res.json({ message: "Hello World" }));

    app.use("/", playground());
  }
})

listen(server);

// const client = new Client<typeof server>("ws://localhost:2567");
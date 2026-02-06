import { createEndpoint, createRouter, defineRoom, defineServer, LocalDriver, LocalPresence } from "@colyseus/core";
import { MyRoom } from "./MyRoom.ts";
import { playground } from "@colyseus/playground";
import { uWebSocketsTransport } from "@colyseus/uwebsockets-transport";

import express from "express";
import serveIndex from "serve-index";
import path from "node:path";

const listThings = createEndpoint("/things", { method: "GET" }, async (ctx) => {
  return { things: [1, 2, 3, 4, 5, 6] };
})

const gameServer = defineServer({
  presence: new LocalPresence(),
  driver: new LocalDriver(),

  rooms: {
    my_room: defineRoom(MyRoom),
  },

  // transport: new uWebSocketsTransport({}),

  express: (app) => {
    app.use("/",
      (req, res, next) => next(),
      serveIndex(path.join(import.meta.dirname, "../"), { 'icons': true }),
      express.static(path.join(import.meta.dirname, "../")),
    )

    app.use("/playground", playground());

    app.get('/express-hello', (req, res) => {
      res.json({ message: 'Hello from Express!' });
    });
  },

  routes: createRouter({
    listThings,

    hello_world: createEndpoint("/hello_world", { method: "GET" }, async (ctx) => {
      return ctx.json({ message: "Hello world!" });
    }),

  })
});

gameServer.listen(2567).then(() => {
  console.log("⚔️ Listening on port http://localhost:2567");
}).catch((err) => {
  console.error("❌ Error listening on port 2567", err);
});
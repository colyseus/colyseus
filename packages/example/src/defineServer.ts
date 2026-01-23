import { createEndpoint, createRouter, defineRoom, defineServer, LocalDriver, LocalPresence } from "@colyseus/core";
import { uWebSocketsTransport } from "@colyseus/uwebsockets-transport";
import { MyRoom } from "./MyRoom.ts";
import { playground } from "@colyseus/playground";

const listThings = createEndpoint("/things", { method: "GET" }, async (ctx) => {
  return { things: [1, 2, 3, 4, 5, 6] };
})

const gameServer = defineServer({
  presence: new LocalPresence(),
  driver: new LocalDriver(),

  rooms: {
    my_room: defineRoom(MyRoom),
  },

  transport: new uWebSocketsTransport({}),

  express: (app) => {
    app.use("/", playground());

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
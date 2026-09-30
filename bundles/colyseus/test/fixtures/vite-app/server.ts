import { defineRoom, defineServer, Room } from "@colyseus/core";

export const server = defineServer({
  greet: false,
  gracefullyShutdown: false,
  rooms: { vite_build_room: defineRoom(class extends Room {}) },
  express: (app) => {
    app.get("/hello", (req, res) => { res.send("hello from express"); });
  },
});

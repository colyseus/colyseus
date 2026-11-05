import { defineRoom, defineServer, Room } from "@colyseus/core";

// a new instance on every evaluation; the plugin shuts the previous one down
const database = { closed: false, async boot() {}, async shutdown() { this.closed = true; } };

export const server = defineServer({
  rooms: { vite_fixture_room: defineRoom(class extends Room {}) },
  database,
  express: (app) => {
    app.get("/database", (req, res) => res.json({ closed: database.closed }));
  },
});

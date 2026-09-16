import { defineRoom, defineServer, Room } from "@colyseus/core";

export const server = defineServer({
  rooms: { vite_fixture_room: defineRoom(class extends Room {}) },
});

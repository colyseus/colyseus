import { createEndpoint, createRouter, defineRoom, defineServer, LocalDriver, LocalPresence } from "@colyseus/core";
import { MyRoom } from "./MyRoom.ts";

const listThings = createEndpoint("/things", { method: "GET" }, async (ctx) => {
  return { things: [1, 2, 3, 4, 5, 6] };
})

const gameServer = defineServer({
  presence: new LocalPresence(),
  driver: new LocalDriver(),

  rooms: {
    my_room: defineRoom(MyRoom),
  },
  routes: createRouter({
    listThings,
  })
});

gameServer.listen(2567);
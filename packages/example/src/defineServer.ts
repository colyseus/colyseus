import { createEndpoint, createRouter, defineRoom, defineServer } from "@colyseus/core";
import { MyRoom } from "./MyRoom";

const listThings = createEndpoint("/things", { method: "GET" }, async (ctx) => {
  return { things: [1, 2, 3, 4, 5, 6] };
})

const gameServer = defineServer({
  my_room: defineRoom(MyRoom),
}, createRouter({
  listThings,
}));

gameServer.listen(2567);
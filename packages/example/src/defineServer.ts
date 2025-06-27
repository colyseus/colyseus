import { defineRoom, defineServer } from "@colyseus/core";
import { MyRoom } from "./MyRoom";

const gameServer = defineServer({
  my_room: defineRoom(MyRoom),
})

gameServer.listen(2567);
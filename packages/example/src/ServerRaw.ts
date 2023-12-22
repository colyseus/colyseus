/**
 * Barebones server without express.
 */
import { Server } from "@colyseus/core";
import { JsonWebToken } from "@colyseus/auth";
import { MyRoom } from "./MyRoom";

JsonWebToken.options.secret = "AIzaSyAMkKUsvM14ctkHUemX3A_h8EBEFPkGII4";

const port = Number(process.env.PORT || 2567);
const endpoint = "localhost";

// Create HTTP & WebSocket servers
const gameServer = new Server();

// Define MyRoom as "my_room"
gameServer.define("my_room_firebase", MyRoom)
  // Matchmaking filters
  // .filterBy(['progress'])

  // demonstrating public events.
  .on("create", (room) => console.log("room created!", room.roomId))
  .on("join", (room, client) => console.log("client", client.sessionId, "joined", room.roomId))
  .on("leave", (room, client) => console.log("client", client.sessionId, "left", room.roomId))
  .on("dispose", (room) => console.log("room disposed!", room.roomId));

gameServer.onShutdown(() => {
  console.log("CUSTOM SHUTDOWN ROUTINE: STARTED");
  return new Promise<void>((resolve, reject) => {
    setTimeout(() => {
      console.log("CUSTOM SHUTDOWN ROUTINE: FINISHED");
      resolve();
    }, 200);
  })
});

process.on('unhandledRejection', r => console.log(r));

gameServer.listen(port);

console.log(`Listening on ws://${ endpoint }:${ port }`)

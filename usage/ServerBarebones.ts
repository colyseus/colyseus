/**
 * Barebones server without express.
 */
import { Server } from "../src";
import { DummyRoom } from "./DummyRoom";

const port = Number(process.env.PORT || 2567);
const endpoint = "localhost";

// Create HTTP & WebSocket servers
const gameServer = new Server();

// Define DummyRoom as "chat"
gameServer.define("chat", DummyRoom)
  // Matchmaking filters
  // .filterBy(['progress'])

  // demonstrating public events.
  .on("create", (room) => console.log("room created!", room.roomId))
  .on("join", (room, client) => console.log("client", client.sessionId, "joined", room.roomId))
  .on("leave", (room, client) => console.log("client", client.sessionId, "left", room.roomId))
  .on("dispose", (room) => console.log("room disposed!", room.roomId));

gameServer.onShutdown(() => {
  console.log("CUSTOM SHUTDOWN ROUTINE: STARTED");
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      console.log("CUSTOM SHUTDOWN ROUTINE: FINISHED");
      resolve();
    }, 1000);
  })
});

process.on('unhandledRejection', r => console.log(r));

gameServer.listen(port);

console.log(`Listening on ws://${ endpoint }:${ port }`)

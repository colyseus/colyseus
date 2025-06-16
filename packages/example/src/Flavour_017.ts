/**
 * Barebones server without express.
 */
import { AuthContext, Room, Server } from "@colyseus/core";
import { MyRoom } from "./MyRoom";
import { Type } from "@colyseus/core/build/utils/types";

function defineServer<T extends Record<string, Type<Room>>>(rooms: T): Server<T> {
  const gameServer = new Server<T>();

  for (const [name, room] of Object.entries(rooms)) {
    gameServer.define(name, room);
  }

  return gameServer;
}

const port = Number(process.env.PORT || 2567);

class Client<T extends Server> {
  joinOrCreate(roomName: keyof T['~rooms']): Promise<RoomConnection<T['~rooms'][typeof roomName]>> {
    return new Promise((resolve, reject) => {
      resolve(new RoomConnection());
    });
  }
}

class RoomConnection<T extends typeof Room> {
  onMessage(message: keyof T['prototype']['messages'], handler: (payload: Parameters<T['prototype']['messages'][typeof message]>[1]) => void) {
  }

  send<M extends keyof T['prototype']['messages']>(
    message: M,
    payload: Parameters<T['prototype']['messages'][M]>[1] = undefined
  ) {
  }
}

const my_room = new MyRoom();

const gs = defineServer({ room: MyRoom });
const client = new Client<typeof gs>()
const room = await client.joinOrCreate("room");
room.send("move", { x: 1, y: 1 });
room.send("nopayload")

// Create HTTP & WebSocket servers
const gameServer = new Server();

// Define MyRoom as "my_room"
gameServer.define("my_room_firebase", MyRoom)
  // demonstrating public events.
  .on("create", (room) => console.log("room created!", room.roomId))
  .on("join", (room, client) => console.log("client", client.sessionId, "joined", room.roomId))
  .on("leave", (room, client) => console.log("client", client.sessionId, "left", room.roomId))
  .on("dispose", (room) => console.log("room disposed!", room.roomId));

gameServer.listen(port);

console.log(`Listening on ws://localhost:${ port }`)

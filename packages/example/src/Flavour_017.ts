/**
 * Barebones server without express.
 */
import { matchMaker, RegisteredHandler, Room, Server } from "@colyseus/core";
import { MyRoom } from "./MyRoom";
import { Type } from "@colyseus/core/build/utils/types";

function defineRoom<T extends Type<Room>>(
  roomKlass: T,
  defaultOptions?: Parameters<NonNullable<InstanceType<T>['onCreate']>>[0],
): RegisteredHandler<T> {
  return new RegisteredHandler(roomKlass, defaultOptions);
}

function defineServer<T extends Record<string, RegisteredHandler>>(roomHandlers: T): Server<T> {
  const gameServer = new Server<T>();

  for (const [name, handler] of Object.entries(roomHandlers)) {
    handler.name = name;
    matchMaker.addRoomType(handler);
  }

  return gameServer;
}


class Client<T extends Server> {
  joinOrCreate(roomName: keyof T['~rooms']): Promise<RoomConnection<T['~rooms'][typeof roomName]['~room']>> {
    return new Promise((resolve, reject) => {
      resolve(new RoomConnection());
    });
  }
}

class RoomConnection<T extends typeof Room> {
  onMessage<M extends keyof T['prototype']['~client']['~messages']>(
    message: M,
    handler: (payload: T['prototype']['~client']['~messages'][M]) => void
  ) {
  }

  send<M extends keyof T['prototype']['messages']>(
    message: M,
    payload: Parameters<T['prototype']['messages'][M]>[1] = undefined
  ) {
  }
}

const port = 2567;

// Create HTTP & WebSocket servers
const gameServer = defineServer({
  my_room: defineRoom(MyRoom)
    .on("create", (room) => console.log("room created!", room.roomId))
    .on("join", (room, client) => console.log("client", client.sessionId, "joined", room.roomId))
    .on("leave", (room, client) => console.log("client", client.sessionId, "left", room.roomId))
    .on("dispose", (room) => console.log("room disposed!", room.roomId))
});

const client = new Client<typeof gameServer>()
const room = await client.joinOrCreate("my_room");
room.onMessage("move", (payload) => {
  payload.x
})
room.send("move", { x: 1, y: 1 });
room.send("nopayload")

// Define MyRoom as "my_room"
gameServer.define("my_room_firebase", MyRoom)
  // demonstrating public events.
  .on("create", (room) => console.log("room created!", room.roomId))
  .on("join", (room, client) => console.log("client", client.sessionId, "joined", room.roomId))
  .on("leave", (room, client) => console.log("client", client.sessionId, "left", room.roomId))
  .on("dispose", (room) => console.log("room disposed!", room.roomId));

gameServer.listen(port);

console.log(`Listening on ws://localhost:${ port }`)

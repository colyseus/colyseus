import { defineServer, defineRoom, Room, DefineClient } from "@colyseus/core";
import { MapSchema, Schema, schema, type } from "@colyseus/schema";

const Player = schema({
    name: "string",
    x: "number",
    y: "number"
});

const MyState = schema({
    players: { map: Player }
})

// class Player extends Schema {
//     @type("string") name: string;
//     @type("number") x: number;
//     @type("number") y: number;
// }
// class MyState extends Schema {
//     @type({ map: Player }) players = new MapSchema();
// }

type Client = DefineClient<{
    userData: { id: string },
    auth: { token: string },
    messages: {
        winner: "string",
    }
}>

class MyRoom extends Room {
    state = new MyState();

    messages = {
        move: (client: Client, payload: { x: number, y: number }) => {
        },
        nopayload: (client: Client) => {
        },
    }

    onJoin(client: Client, options?: any): void | Promise<any> {
        client.send("winner", );
    }

}

// Server-side
export const gameServer = defineServer({
  my_room: defineRoom(MyRoom)
});

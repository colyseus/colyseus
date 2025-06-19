import { Client } from "colyseus.js";

export async function connect() {
    const client = new Client("ws://localhost:2567");
    const room = await client.joinOrCreate("my_room");
    room.onStateChange((state) => console.log("onStateChange:", { state }));
    room.onLeave((code) => console.log("onLeave:", { code }));
    return room;
}

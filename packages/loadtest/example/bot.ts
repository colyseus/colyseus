import { Options } from '@colyseus/loadtest';
import { Room, Client } from "colyseus.js";

export async function main(options: Options) {
    const client = new Client(options.endpoint);
    const room: Room = await client.joinOrCreate(options.roomName, options.requestJoinOptions);
    room.send('message-type', {})
    room.onMessage("message-type", (payload) => {
        // logic
    });
    room.onLeave((code) => {
        // logic
    });
    await room.leave(true);
}

///<reference path="../dist/colyseus.d.ts" />

// included bundled types
import * as Colyseus from "../dist/colyseus.js";

// include server types
import type { MyRoom, MyRoomState } from "../../example/src/MyRoom.ts";

const client = new Colyseus.Client("ws://localhost:2567");

client.joinOrCreate<MyRoom>("my_room").then((room) => {
    var callbacks = Colyseus.Callbacks.get(room);

    callbacks.onAdd("players", (player, key) => {
        console.log("player added", player.x, player.y);

        callbacks.onChange(player, () => {
            console.log("player changed", player.x, player.y);
        });
    });

    callbacks.onRemove("players", (player, key) => {
        console.log("player removed", player.x, player.y);
    });
});
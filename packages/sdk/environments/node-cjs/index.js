const Colyseus = require("colyseus.js");

const client = new Colyseus.Client("ws://localhost:2567");
client.joinOrCreate("my_room").then((room) => {
    room.onStateChange((state) => console.log("onStateChange:", { state }));
    room.onLeave((code) => console.log("onLeave:", { code }));
});

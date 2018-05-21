//
// This example shows how to use the "cluster" module with Colyseus.
//
// You must specify the `presence` option on Colyseus.Server when using multiple
// processes.
//

import * as os from "os";
import * as cluster from "cluster";
import * as http from "http";
import * as colyseus from "../src";

import { ChatRoom } from "./ChatRoom"

const port = Number(process.env.PORT || 2567);
const endpoint = "localhost";

if (cluster.isMaster) {
    // This only happens on the master server
    console.log("Starting master server.");
    console.log(`Running on Node.js ${process.version}.`);

    const cpus = os.cpus().length;
    for (let i = 0; i < cpus; ++i) {
        cluster.fork();
    }

} else {
    // This happens on the slave processes.

    // We create a new game server and register the room.
    const gameServer = new colyseus.Server({
        server: http.createServer(),
        presence: new colyseus.MemsharedPresence()
    });

    gameServer.register("chat", ChatRoom);
    gameServer.listen(port);

    console.log(`Listening on ws://${endpoint}:${port}`)
}

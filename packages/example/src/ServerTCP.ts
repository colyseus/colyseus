/**
 * WARNING: TCP IMPLEMENTATION IS NOT WORKING YET
 * CONTRIBUTIONS ARE WELCOME
 */
import * as net from "net";

import { Server } from "@colyseus/core";
import { MyRoom } from "./MyRoom";

const port = Number(process.env.PORT || 8181);
const endpoint = "localhost";

/*

const engine = net.Server;

// Create TCP server
const gameServer = new Server({ engine });

// Register DummyRoom as "chat"
gameServer.define("my_room", MyRoom);

process.on('unhandledRejection', r => console.log(r));
gameServer.listen(port);

console.log(`Listening on tcp://${ endpoint }:${ port }`)

*/
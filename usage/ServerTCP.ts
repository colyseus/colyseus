import * as net from "net";

import { Server } from "../src/Server";
import { ChatRoom } from "./ChatRoom";

const port = Number(process.env.PORT || 8181);
const endpoint = "localhost";

const engine = net.Server;

// Create TCP server
const gameServer = new Server({ engine });

// Register ChatRoom as "chat"
gameServer.register("chat", ChatRoom);

process.on('unhandledRejection', r => console.log(r));
gameServer.listen(port);

console.log(`Listening on tcp://${ endpoint }:${ port }`)

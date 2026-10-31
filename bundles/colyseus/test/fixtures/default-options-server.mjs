/**
 * Spawned by ServerProcess.test.ts: a server on default options, where an error
 * that escapes the framework stops this process.
 */
import { LobbyRoom, Room, Server, subscribeLobby } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";

class FaultyRoom extends Room {
  onCreate() {
    this.onMessage("sync", () => { throw new Error("sync onMessage Error"); });
    this.onMessage("async", async () => { throw new Error("async onMessage Error"); });
  }
}

const server = new Server({ greet: false, transport: new WebSocketTransport() });

server.define("lobby", LobbyRoom);
server.define("faulty", FaultyRoom).enableRealtimeListing();

await server.listen(Number(process.env.PORT));

await subscribeLobby(() => { throw new Error("subscribeLobby listener Error"); });

console.log("listening");

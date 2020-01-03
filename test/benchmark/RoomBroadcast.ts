import Benchmark from "benchmark";

import { Room, Server, matchMaker, Protocol } from "../../src";
import WebSocket from "ws";
import { Deferred } from "../../src/Utils";
import msgpack from "notepack.io";

const numClients = 5;
const suite = new Benchmark.Suite();
const connections: WebSocket[] = [];

class MyRoom extends Room {
  onCreate() { this.setSeatReservationTime(10); }
  onMessage() { }
}

let received: number = 0;

const server = new Server();
server.define("room", MyRoom);
server.listen(9999, undefined, undefined, async () => {
  const roomCreated = await matchMaker.createRoom("room", {});
  const room = matchMaker.getRoomById(roomCreated.roomId);

  const future = new Deferred();

  // add dumb clients
  for (let i = 0; i < numClients; i++) {
    const seatReservation = await matchMaker.reserveSeatFor(roomCreated, {});
    const room = new WebSocket(`ws://localhost:9999/${seatReservation.room.processId}/${seatReservation.room.roomId}?sessionId=${seatReservation.sessionId}`);
    room.on("open", () => {
      connections.push(room);

      room.on("message", (message: Buffer) => {
        room.send(msgpack.encode([Protocol.JOIN_ROOM]), { binary: true }, (err) => {
          // give some time for confirmation to be acknowledged
          if (connections.length === numClients) {
            setTimeout(() => future.resolve(), 100);
          }
        });
      })

    });
  }

  await future.promise;
  console.log("ALL CONNECTIONS OPEN!");

  /**
   * 0.11.x =>
   * broadcast x 7,478 ops/sec ±16.50% (60 runs sampled)
   * broadcast x 2,606 ops/sec ±35.69% (52 runs sampled)
   * broadcast x 6,293 ops/sec ±14.92% (58 runs sampled)
   */

  /**
   * 0.12.x =>
   * broadcast x 27,069 ops/sec ±24.11% (61 runs sampled)
   * broadcast x 25,954 ops/sec ±27.80% (65 runs sampled)
   */
  suite.add('broadcast', function () {
    room.broadcast("hello world!");
  });

  suite.on('cycle', (event) => {
    console.log(String(event.target));
  });

  suite.on('complete', function (event) {
    console.log('Fastest is ' + this.filter('fastest').map('name'));
    process.exit();
  });

  suite.run();

});

import * as Benchmark from "benchmark";
import * as msgpack from "notepack.io";
import * as fossilDelta from "fossil-delta";
import * as nodeDelta from "node-delta";
import * as util from "util";
import { DummyRoom, createDummyClient } from "../utils/mock";
import { generateId, Protocol } from "../../src";
import { toJSON } from "../../src/Utils";

const NUM_CLIENTS = 10;
const NUM_MONSTERS = 500;
const MAP_GRID_SIZE = 200;

const suite = new Benchmark.Suite();
const room = new DummyRoom();
room.roomName = "dummy";
room.roomId = generateId();

// build 200x200 map
const map = [];
for (var i=0; i<MAP_GRID_SIZE; i++) {
  map[i] = [];
  for (var j=0; j<MAP_GRID_SIZE; j++) {
    map[i].push( (Math.random() > 0.5) ? 0 : 1 );
  }
}

// build 500 monsters
let monsters = {};
for (let i=0; i<NUM_MONSTERS; i++) {
  monsters[ generateId() ] = {
    x: Math.round(Math.random() * 200),
    y: Math.round(Math.random() * 200)
  };
}

// build 10 players
let players = {};
for (let i=0; i<NUM_CLIENTS; i++) {
  let client = createDummyClient();
  (<any>room)._onJoin( client );
  players[ client.id ] = {
    x: Math.round(Math.random() * 200),
    y: Math.round(Math.random() * 200)
  };
}

function moveMonsters () {
  for (let id in monsters) {
    monsters[ id ].x += (Math.random() > 0.5) ? 1 : -1;
    monsters[ id ].y += (Math.random() > 0.5) ? 1 : -1;
  }
}

function movePlayers () {
  for (let id in players) {
    players[ id ].x += (Math.random() > 0.5) ? 1 : -1;
    players[ id ].y += (Math.random() > 0.5) ? 1 : -1;
  }
}

let state = { map, monsters, players };

let encodedState = msgpack.encode( state );
let secondEncodedState = msgpack.encode( state );

function distance (p1, p2) {
  let a = p1.x - p2.x;
  let b = p1.y - p2.y;
  return Math.sqrt( a*a + b*b  );
}

room.setState(state);

// suite.add('toJSON', () => toJSON(state));
// suite.add('plain data', () => state);
//
// suite.add('encodedState.equals()', () => {
//   encodedState.equals(secondEncodedState);
// });

let previousState = msgpack.encode(toJSON(state));
moveMonsters();
movePlayers();
let nextState = msgpack.encode(toJSON(state));

let deltaData = fossilDelta.create(previousState, nextState);

// suite.add('fossilDelta.create()', () => {
//   fossilDelta.create(previousState, nextState);
// });
//
// suite.add('nodeDelta.create()', () => {
//   nodeDelta.create(previousState, nextState);
// });
//
// suite.add('msgpack.encode delta', () => {
//   msgpack.encode([Protocol.ROOM_STATE_PATCH, room.roomId, deltaData]);
// });

let numBytesPatches = 0;
suite.add('Room#broadcastPatch', function() {
  moveMonsters();
  movePlayers();
  (<any>room).broadcastPatch();
});

suite.on('cycle', e => console.log( e.target.toString() ));

suite.run();
console.log("Done.")

process.exit();

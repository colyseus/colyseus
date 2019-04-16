//
// This example shows how to scale the Colyseus.Server.
//
// You must specify the `presence` option on Colyseus.Server when using multiple
// processes. This example uses Redis as presence server.
//

import bodyParser from 'body-parser';
import express from 'express';
import http from 'http';

import { Server } from '../src/Server';
import { RedisPresence } from './../src/presence/RedisPresence';
import { ChatRoom } from './ChatRoom';

const port = Number(process.env.PORT || 2567);
const endpoint = 'localhost';

const app = express();

// Create HTTP & WebSocket servers
const server = http.createServer(app);
const gameServer = new Server({
  presence: new RedisPresence(),
  server,
  verifyClient: (info, next) => {
    // console.log("custom verifyClient!");
    next(true);
  },
});

// Register ChatRoom as "chat"
gameServer.register('chat', ChatRoom).then((handler) => {
  handler.
    // demonstrating public events.
    on('create', (room) => console.log('handler: room created!', room.roomId)).
    on('join', (room, client) => console.log('handler: client', client.sessionId, 'joined', room.roomId)).
    on('leave', (room, client) => console.log('handler: client', client.sessionId, 'left', room.roomId)).
    on('dispose', (room) => console.log('handler: room disposed!', room.roomId));
});

app.use(express.static(__dirname));
app.use(bodyParser.json());

gameServer.listen(port);

console.log(`Listening on http://localhost:${ port }`);

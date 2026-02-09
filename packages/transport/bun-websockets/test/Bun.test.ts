import assert from 'assert';
import { createRouter, createEndpoint, defineRoom, defineServer, Room, matchMaker } from '@colyseus/core';
import { ColyseusSDK } from '@colyseus/sdk';

import { BunWebSockets } from '../src/BunWebSockets.ts';

class DummyRoom extends Room {
  public onCreateOptions: any = {};
  onCreate(options) {
    this.onCreateOptions = options;
  }
  onJoin() {}
  onLeave() {}
  onDispose() {}
}

describe('BunWebSockets', () => {
  it('defineServer + createEndpoint', async () => {
    const server = defineServer({
      greet: false,
      transport: new BunWebSockets(),
      rooms: {
        dummy: defineRoom(DummyRoom),
      },
      routes: createRouter({
        dummy: createEndpoint('/dummy', { method: 'GET' }, async (ctx) => {
          return { message: 'Hello from server' };
        }),
      }),
    })

    await server.listen(8567);

    const client = new ColyseusSDK(`ws://localhost:8567`);
    assert.equal((await client.http.get('/dummy')).data.message, 'Hello from server');

    const sdkRoom = await client.joinOrCreate('dummy', { foo: 'bar' });
    const room = matchMaker.getLocalRoomById(sdkRoom.roomId) as DummyRoom;
    assert.equal(room.roomName, 'dummy');
    assert.equal(room.roomId, sdkRoom.roomId);
    assert.equal(room.onCreateOptions.foo, 'bar');

    await server.gracefullyShutdown(false);
  });

  it('defineServer + createEndpoint + express routes', async () => {
    const server = defineServer({
      greet: false,
      transport: new BunWebSockets(),
      rooms: {
        dummy: defineRoom(DummyRoom),
      },
      routes: createRouter({
        dummy: createEndpoint('/dummy', { method: 'GET' }, async (ctx) => {
          return { message: 'Hello from server' };
        }),
      }),
      express: (app) => {
        app.get('/express', (req, res) => {
          console.log("reached express route");
          res.send({ message: 'Hello from express' });
        });
      }
    })

    await server.listen(8567);

    const client = new ColyseusSDK(`ws://localhost:8567`);

    assert.equal((await client.http.get('/dummy')).data.message, 'Hello from server');

    console.log("will get /express");
    assert.equal((await client.http.get('/express')).data.message, 'Hello from express');
    console.log("got it!");

    // const sdkRoom = await client.joinOrCreate('dummy', { foo: 'bar' });
    // const room = matchMaker.getLocalRoomById(sdkRoom.roomId) as DummyRoom;
    // assert.equal(room.roomName, 'dummy');
    // assert.equal(room.roomId, sdkRoom.roomId);
    // assert.equal(room.onCreateOptions.foo, 'bar');

    await server.gracefullyShutdown(false);
  });
});
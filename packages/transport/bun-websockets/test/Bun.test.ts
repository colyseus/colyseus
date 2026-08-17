import assert from 'assert';
import EventEmitter from 'events';
import { createRouter, createEndpoint, defineRoom, defineServer, Room, matchMaker, getMessageBytes, Protocol, ClientState } from '@colyseus/core';
import { ColyseusSDK } from '@colyseus/sdk';

import { BunWebSockets } from '../src/BunWebSockets.ts';
import { WebSocketClient } from '../src/WebSocketClient.ts';

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

  it('simulateLatency should not break sendBinary', async () => {
    const transport = new BunWebSockets();
    const server = defineServer({
      greet: false,
      transport,
      rooms: {
        dummy: defineRoom(DummyRoom),
      },
    });

    transport.simulateLatency(1);

    await server.listen(8567);

    const client = new ColyseusSDK(`ws://localhost:8567`);
    const sdkRoom = await client.joinOrCreate('dummy');
    const room = matchMaker.getLocalRoomById(sdkRoom.roomId) as DummyRoom;
    assert.equal(room.roomName, 'dummy');

    // wait for delayed messages to be sent
    await Bun.sleep(100);

    await sdkRoom.leave();
    await server.gracefullyShutdown(false);
  });

  it('beforeUpgrade', async () => {
    let requestUrl: string;
    let contextIp: string | undefined;
    let intercept = false;

    const server = defineServer({
      greet: false,
      transport: new BunWebSockets({
        beforeUpgrade: async (request, context) => {
          await Bun.sleep(20);
          requestUrl = request.url;
          contextIp = context.ip;
          if (intercept) {
            return new Response(null, { headers: { 'fly-replay': 'instance=abc123' } });
          }
        },
      }),
      rooms: { dummy: defineRoom(DummyRoom) },
    });

    await server.listen(8569);

    const client = new ColyseusSDK(`ws://localhost:8569`);
    const sdkRoom = await client.joinOrCreate('dummy');
    assert.ok(requestUrl.includes(`/${sdkRoom.roomId}`), `unexpected request url: ${requestUrl}`);
    assert.ok(contextIp, `expected a client address, got ${contextIp}`);
    await sdkRoom.leave();

    // a returned Response answers the request instead of upgrading
    intercept = true;
    const response = await fetch('http://localhost:8569/whatever', {
      headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==', 'Sec-WebSocket-Version': '13' },
    });
    assert.equal(response.headers.get('fly-replay'), 'instance=abc123');

    await server.gracefullyShutdown(false);
  });

  it('client.raw() should accept non-ArrayBufferView data without throwing', async () => {
    const port = 8568;

    let serverWs: any;
    const server = Bun.serve({
      port,
      fetch(req, server) {
        if (server.upgrade(req)) return;
        return new Response("Not found", { status: 404 });
      },
      websocket: {
        open(ws) { serverWs = ws; },
        message() {},
        close() {},
      },
    });

    // connect and wait for the server-side ws to be ready
    const clientWs = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise<void>((resolve) => { clientWs.onopen = () => resolve(); });
    await Bun.sleep(50);

    const wrapper = Object.assign(new EventEmitter(), { ws: serverWs });
    const client = new WebSocketClient("test-session", wrapper as any);
    client.state = ClientState.JOINED;

    // getMessageBytes[Protocol.ROOM_STATE] returns number[] — not an ArrayBufferView.
    // Bun's sendBinary rejects number[] with "sendBinary requires an ArrayBufferView".
    // client.raw() must handle this gracefully.
    const data = getMessageBytes[Protocol.ROOM_STATE]([1, 2, 3]);
    assert.ok(Array.isArray(data), 'ROOM_STATE bytes should be a plain array');
    assert.ok(!ArrayBuffer.isView(data), 'ROOM_STATE bytes should NOT be an ArrayBufferView');

    // should not throw
    client.raw(data as any);

    clientWs.close();
    server.stop();
  });
});
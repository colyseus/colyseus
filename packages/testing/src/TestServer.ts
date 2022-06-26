import { Server, Room, matchMaker } from "@colyseus/core";
import { Client } from "colyseus.js";
import * as httpie from "httpie";

export class ColyseusTestServer {
  // matchmaking methods
  public sdk: {
    joinOrCreate: Client['joinOrCreate'],
    join: Client['join'],
    create: Client['create'],
    joinById: Client['joinById'],
    reconnect: Client['reconnect'],
  };

  public http: {
    get: typeof httpie.get,
    post: typeof httpie.post,
    patch: typeof httpie.patch,
    delete: typeof httpie.del,
    put: typeof httpie.put,
  };

  constructor(public server: Server) {
    const hostname = "127.0.0.1";
    const port = server['port'];
    const client = new Client(`ws://${hostname}:${port}`);

    const httpEndpoint = `http://${hostname}:${port}`;
    this.http = {
      ['get']: (segments, opts) => httpie.get(`${httpEndpoint}${segments}`, opts),
      ['post']: (segments, opts) => httpie.post(`${httpEndpoint}${segments}`, opts),
      ['patch']: (segments, opts) => httpie.patch(`${httpEndpoint}${segments}`, opts),
      ['delete']: (segments, opts) => httpie.del(`${httpEndpoint}${segments}`, opts),
      ['put']: (segments, opts) => httpie.put(`${httpEndpoint}${segments}`, opts),
    };

    this.sdk = {
      joinOrCreate: function() {
        return client.joinOrCreate.apply(client, arguments);
      },
      join: client.join.bind(client),
      create: client.create.bind(client),
      joinById: client.joinById.bind(client),
      reconnect: client.reconnect.bind(client),
    };
  }

  async createRoom<State = any, Metadata = any>(roomName: string, clientOptions: any = {}) {
    const room = await matchMaker.createRoom(roomName, clientOptions);
    return this.getRoomById<State, Metadata>(room.roomId);
  }

  connectTo<T>(room: Room<T>, clientOptions: any = {}) {
    return this.sdk.joinById<T>(room.roomId, clientOptions);
  }

  getRoomById<State = any, Metadata = any>(roomId: string) {
    return matchMaker.getRoomById(roomId) as Room<State, Metadata>;
  }

  async cleanup() {
    // ensure no rooms are still alive
    await matchMaker.disconnectAll();

    const driver = this.server['driver'];
    if (driver) { await driver.clear(); }
  }

  async shutdown() {
    await this.server.gracefullyShutdown(false);
  }

}
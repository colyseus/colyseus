import { Server, matchMaker } from "@colyseus/core";
import { Client } from "colyseus.js";



export class ColyseusTestServer {
  // matchmaking methods
  public clientSDK: {
    joinOrCreate: Client['joinOrCreate'],
    join: Client['join'],
    create: Client['create'],
    joinById: Client['joinById'],
  };

  constructor(public server: Server) {
    const client = new Client(`ws://127.0.0.1:${server['port']}`);

    this.clientSDK = {
      joinOrCreate: client.joinOrCreate.bind(client),
      join: client.join.bind(client),
      create: client.create.bind(client),
      joinById: client.joinById.bind(client),
    };
  }

  async cleanup() {
    const driver = this.server['driver'];

    if (driver) { await driver.clear(); }

    // re-initialize presence and driver
    matchMaker.setup(this.server['presence'], driver, this.server['processId']);
  }

  async shutdown() {
    await this.server.gracefullyShutdown(false);
  }

  getRoomById(roomId: string) {
    return matchMaker.getRoomById(roomId);
  }

  async createRoom(roomName: string, clientOptions: any) {
    const room = await matchMaker.createRoom(roomName, clientOptions);
    return this.getRoomById(room.roomId);
  }

}
import msgpack from "notepack.io";
import WebSocket from "ws";
import { EventEmitter } from "events";

import { Room } from "../../src/Room";
import { SeatReservation } from "../../src/MatchMaker";

import { LocalDriver } from "../../src/matchmaker/drivers/LocalDriver";
import { MongooseDriver } from "../../src/matchmaker/drivers/MongooseDriver";
import { LocalPresence, RedisPresence, Presence } from "../../src";

export const DRIVERS = [
  new LocalDriver(),
  new MongooseDriver('mongodb://127.0.0.1:27017/colyseus_test'),
];

export const PRESENCE_IMPLEMENTATIONS: Presence[] = [
  new LocalPresence(),
  new RedisPresence()
];

export class Client extends EventEmitter {
  public sessionId: string;
  public messages: Array<any> = [];
  public readyState: number = WebSocket.OPEN;

  constructor (id?: string) {
    super();
    this.sessionId = id || null;

    this.once('close', () => this.readyState = WebSocket.CLOSED);
  }

  send (message) {
    this.messages.push(message);
  }

  receive (message) {
    this.emit('message', msgpack.encode(message));
  }

  getMessageAt(index: number) {
    return msgpack.decode(this.messages[index]);
  }

  get lastMessage () {
    return this.getMessageAt(this.messages.length - 1);
  }

  close (code?: number) {
    this.readyState = WebSocket.CLOSED;
    this.emit('close');
  }

  terminate() {
    this.emit('close');
  }

}

export function createEmptyClient() {
  return new Client();
}

export function createDummyClient (seatReservation: SeatReservation, options: any = {}) {
  let client = new Client(seatReservation.sessionId);
  (<any>client).options = options;
  return client;
}

export function timeout(ms: number = 200) {
  return new Promise((resolve, reject) => setTimeout(resolve, ms));
}

export class DummyRoom extends Room {
  onCreate() { }
  onDispose() { }
  onJoin() { }
  onLeave() { }
  onMessage(client, message) { this.broadcast(message); }
}

export class Room2Clients extends Room {
  maxClients = 2;

  onCreate() { }
  onDispose() { }
  onJoin() { }
  onLeave() { }
  onMessage(client, message) { this.broadcast(message); }
}

export class Room2ClientsExplicitLock extends Room {
  maxClients = 2;

  onCreate() { }
  onDispose() { }
  onJoin() { }
  onLeave() { }
  onMessage(client, message) {
    if (message === "lock") {
      this.lock();
    }
  }
}

export class Room3Clients extends Room {
  maxClients = 3;

  onCreate() { }
  onDispose() { }
  onJoin() { }
  onLeave() { }
  onMessage(client, message) { this.broadcast(message); }
}

export class ReconnectRoom extends Room {
  maxClients = 4;

  onCreate() { }
  onDispose() { }
  onJoin() { }

  async onLeave(client, consented) {
    try {
      if (consented) throw new Error("consented");
      await this.allowReconnection(client, 0.2); // 200ms

    } catch (e) {
      // console.log("allowReconnection, error =>", e.message);
    }
  }
  onMessage(client, message) { this.broadcast(message); }
}

export class RoomWithAsync extends DummyRoom {
  static ASYNC_TIMEOUT = 200;
  maxClients = 1;

  async onAuth() {
    await timeout(RoomWithAsync.ASYNC_TIMEOUT);
    return true;
  }

  onJoin () {}

  async onLeave() {
    await timeout(RoomWithAsync.ASYNC_TIMEOUT);
  }

  async onDispose() {
    await timeout(RoomWithAsync.ASYNC_TIMEOUT);
  }
}
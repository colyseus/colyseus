import msgpack from "notepack.io";
import WebSocket from "ws";
import { EventEmitter } from "events";

import { Room } from "../../src/Room";
import { SeatReservation } from "../../src/MatchMaker";

import { LocalDriver } from "../../src/matchmaker/drivers/LocalDriver";
import { MongooseDriver } from "../../src/matchmaker/drivers/MongooseDriver";
import { LocalPresence, RedisPresence, Presence, Client, Deferred } from "../../src";
import { ClientState } from "../../src/transport/Transport";

// export const DRIVERS = [ new LocalDriver(), ];
// export const PRESENCE_IMPLEMENTATIONS: Presence[] = [ new LocalPresence(), ];

export const DRIVERS = [
  new LocalDriver(),
  new MongooseDriver('mongodb://127.0.0.1:27017/colyseus_test'),
];

export const PRESENCE_IMPLEMENTATIONS: Presence[] = [
  new LocalPresence(),
  new RedisPresence()
];

export class RawClient extends EventEmitter {
  readyState: number;
}

export class WebSocketClient implements Client {
  id: string;
  sessionId: string;
  ref: RawClient;
  state: ClientState = ClientState.JOINING;

  messages: any[] = [];
  _enqueuedMessages: any[] = [];

  errors: any[] = [];

  constructor (id?: string) {
    this.id = id || null;
    this.sessionId = id || null;
    this.ref = new RawClient();
    this.ref.once('close', () => this.ref.readyState = WebSocket.CLOSED);
  }

  send (message) {
    this.messages.push(message);
  }

  receive (message) {
    this.ref.emit('message', msgpack.encode(message));
  }

  getMessageAt(index: number) {
    return msgpack.decode(this.messages[index]);
  }

  raw(message, options) {
    this.messages.push(message);
  }

  enqueueRaw(message, options) {
    if (this.state === ClientState.JOINING) {
      this._enqueuedMessages.push(message);
      return;
    }
    this.messages.push(message);
  }

  error(code, message) {
    this.errors.push([code, message]);
  }

  get lastMessage () {
    return this.getMessageAt(this.messages.length - 1);
  }

  get readyState () {
    return this.ref.readyState;
  }

  leave(code?: number) {
    this.ref.readyState = WebSocket.CLOSED;
    this.ref.emit('close');
  }

  close (code?: number) {
    this.leave(code);
  }

  terminate() {
    this.ref.emit('close');
  }

}

export function createEmptyClient() {
  return new WebSocketClient();
}

export function createDummyClient (seatReservation: SeatReservation, options: any = {}) {
  let client = new WebSocketClient(seatReservation.sessionId);
  (<any>client).options = options;
  return client;
}

export function timeout(ms: number = 200) {
  return new Promise((resolve, reject) => setTimeout(resolve, ms));
}

export class DummyRoom extends Room {
  onCreate() {
    this.onMessage("*", (_, type, message) => {
      this.broadcast(type, message);
    });
  }
  onDispose() { }
  onJoin() { }
  onLeave() { }
}

export class Room2Clients extends Room {
  maxClients = 2;

  onCreate() {
    this.onMessage("*", (_, type, message) => {
      this.broadcast(type, message);
    });
  }
  onDispose() { }
  onJoin() { }
  onLeave() { }
}

export class Room2ClientsExplicitLock extends Room {
  maxClients = 2;

  onCreate() {
    this.onMessage("lock", () => this.lock());
  }
  onDispose() { }
  onJoin() { }
  onLeave() { }
}

export class Room3Clients extends Room {
  maxClients = 3;

  onCreate() {
    this.onMessage("*", (_, type, message) => {
      this.broadcast(type, message);
    });
  }

  onDispose() { }
  onJoin() { }
  onLeave() { }
}

export class ReconnectRoom extends Room {
  maxClients = 4;

  onCreate() {
    this.onMessage("*", (_, type, message) => {
      this.broadcast(type, message);
    });
  }
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
}

export class ReconnectTokenRoom extends Room {
  maxClients = 4;
  token: Deferred;

  onCreate() {
    this.setState({})
  }
  onDispose() { }

  onJoin(client) {
    this.state[client.sessionId] = "CONNECTED";
  }

  async onLeave(client, consented) {
    if (!consented) {
      const reconnection = this.allowReconnection(client);
      this.token = reconnection;

      try {
        await reconnection;

      } catch (e) {
      }

    }
  }

  onMessage(client, message) {}
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
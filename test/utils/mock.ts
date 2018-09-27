import * as shortid from "shortid";
import * as msgpack from "notepack.io";
import * as WebSocket from "ws";
import { EventEmitter } from "events";

import { Room } from "../../src/Room";
import { LocalPresence } from './../../src/presence/LocalPresence';

export class Client extends EventEmitter {

  public id: string;
  public messages: Array<any> = [];
  public readyState: number = WebSocket.OPEN;

  constructor (id?: string) {
    super();
    this.id = id || null;

    this.on('close', () => {
      this.readyState = WebSocket.CLOSED
    });
  }

  send (message) {
    this.messages.push(message);
  }

  getMessageAt(index: number) {
    return msgpack.decode(this.messages[index]);
  }

  get lastMessage () {
    return this.getMessageAt(this.messages.length - 1);
  }

  close (code?: number) {
    this.emit('close', code);
  }

}

export function createEmptyClient(): any {
  return new Client();
}

export function createDummyClient (options?: any): any {
  let client = new Client(shortid.generate());
  (<any>client).options = options;
  return client;
}

export function awaitForTimeout(ms: number) {
  return new Promise((resolve, reject) => setTimeout(resolve, ms));
}

export class DummyRoom extends Room {
  constructor () {
    super(new LocalPresence());
  }

  requestJoin (options) {
    return !options.invalid_param
  }

  onInit () { this.setState({}); }
  onDispose() {}
  onJoin() {}
  onLeave() {}
  onMessage() {}
}

export class RoomWithError extends Room {
  constructor () {
    super(new LocalPresence());
  }
  onInit () { this.setState({}); }
  onDispose() {}
  onJoin() {
    (<any>this).iHaveAnError();
  }
  onLeave() {}
  onMessage() {}
}


export class DummyRoomWithState extends Room {
  constructor () {
    super(new LocalPresence());
    this.setState({ number: 10 });
  }

  requestJoin (options) {
    return !options.invalid_param;
  }

  onInit () {}
  onDispose() {}
  onJoin() {}
  onLeave() {}
  onMessage() {}
}

export class DummyRoomWithTimeline extends Room {
  constructor () {
    super(new LocalPresence());
    this.useTimeline()
  }

  requestJoin (options) {
    return !options.invalid_param
  }

  onInit () { this.setState({}); }
  onDispose() {}
  onJoin() {}
  onLeave() {}
  onMessage() {}
}

export class RoomVerifyClient extends DummyRoom {
  patchRate = 5000;
  onJoin () {}
}

export class RoomWithAsync extends DummyRoom {
  static ASYNC_TIMEOUT = 200;

  maxClients = 1;

  async onAuth() {
    await awaitForTimeout(RoomWithAsync.ASYNC_TIMEOUT);
    return true;
  }

  onJoin () {}

  async onLeave() {
    await awaitForTimeout(RoomWithAsync.ASYNC_TIMEOUT);
  }

  async onDispose() {
    await awaitForTimeout(RoomWithAsync.ASYNC_TIMEOUT);
  }
}

export class RoomVerifyClientWithLock extends DummyRoom {
  patchRate = 5000;

  async verifyClient () {
    return new Promise((resolve, reject) => {
      setTimeout(() => resolve(true), 100);
    });
  }

  onJoin () {
    this.lock();
  }

}
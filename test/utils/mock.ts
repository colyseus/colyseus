import msgpack from "notepack.io";
import WebSocket from "ws";
import { EventEmitter } from "events";

import { generateId, serialize, FossilDeltaSerializer } from "../../src";
import { Room } from "../../src/Room";
import { LocalPresence } from './../../src/presence/LocalPresence';

export class Client extends EventEmitter {

  public id: string;
  public messages: Array<any> = [];
  public readyState: number = WebSocket.OPEN;

  constructor (id?: string) {
    super();
    this.id = id || null;

    this.once('close', () => {
      this.readyState = WebSocket.CLOSED
    });
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

}

export function createEmptyClient(): any {
  return new Client();
}

export function createDummyClient (options: any = {}): any {
  const id = options.id || generateId();
  delete options.id;

  let client = new Client(id);
  (<any>client).options = options;
  return client;
}

export function awaitForTimeout(ms: number = 200) {
  return new Promise((resolve, reject) => setTimeout(resolve, ms));
}

@serialize(FossilDeltaSerializer)
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
  onMessage(client, message) { this.broadcast(message); }
}

@serialize(FossilDeltaSerializer)
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

@serialize(FossilDeltaSerializer)
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

@serialize(FossilDeltaSerializer)
export class RoomVerifyClient extends DummyRoom {
  patchRate = 5000;
  onJoin () {}
}

@serialize(FossilDeltaSerializer)
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

@serialize(FossilDeltaSerializer)
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

export function utf8Read(buff: Buffer, offset: number) {
  const length = buff.readUInt8(offset++);

  var string = '', chr = 0;
  for (var i = offset, end = offset + length; i < end; i++) {
    var byte = buff.readUInt8(i);
    if ((byte & 0x80) === 0x00) {
      string += String.fromCharCode(byte);
      continue;
    }
    if ((byte & 0xe0) === 0xc0) {
      string += String.fromCharCode(
        ((byte & 0x1f) << 6) |
        (buff.readUInt8(++i) & 0x3f)
      );
      continue;
    }
    if ((byte & 0xf0) === 0xe0) {
      string += String.fromCharCode(
        ((byte & 0x0f) << 12) |
        ((buff.readUInt8(++i) & 0x3f) << 6) |
        ((buff.readUInt8(++i) & 0x3f) << 0)
      );
      continue;
    }
    if ((byte & 0xf8) === 0xf0) {
      chr = ((byte & 0x07) << 18) |
        ((buff.readUInt8(++i) & 0x3f) << 12) |
        ((buff.readUInt8(++i) & 0x3f) << 6) |
        ((buff.readUInt8(++i) & 0x3f) << 0);
      if (chr >= 0x010000) { // surrogate pair
        chr -= 0x010000;
        string += String.fromCharCode((chr >>> 10) + 0xD800, (chr & 0x3FF) + 0xDC00);
      } else {
        string += String.fromCharCode(chr);
      }
      continue;
    }
    throw new Error('Invalid byte ' + byte.toString(16));
  }
  return string;
}
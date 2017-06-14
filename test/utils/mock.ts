"use strict";

import { EventEmitter } from "events";
import * as shortid from "shortid";
import * as msgpack from "msgpack-lite";
import * as WebSocket from "uws";
import { Room } from "../../src/Room";

export class Client extends EventEmitter {

  public id: string;
  public messages: Array<any> = [];

  constructor (id?: string) {
    super();
    this.id = id || null;
  }

  send (message) {
    this.messages.push(message);
  }

  get lastMessage () {
    return msgpack.decode(this.messages[ this.messages.length - 1 ]);
  }

  close () {
    this.messages = [];
    // this.emit('close');
  }

}

export function createEmptyClient(): any {
  return new Client()
}

export function createDummyClient (): any {
  return new Client(shortid.generate())
}

export class DummyRoom extends Room {
  requestJoin (options) {
    return !options.invalid_param
  }

  onInit () {}
  onDispose() {}
  onJoin() {}
  onLeave() {}
  onMessage() {}
}

export class RoomWithError extends Room {
  onInit () {}
  onDispose() {}
  onJoin() {
    (<any>this).iHaveAnError();
  }
  onLeave() {}
  onMessage() {}
}


export class DummyRoomWithState extends Room {
  constructor () {
    super();
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
    super();
    this.useTimeline()
  }


  requestJoin (options) {
    return !options.invalid_param
  }

  onInit () {}
  onDispose() {}
  onJoin() {}
  onLeave() {}
  onMessage() {}
}

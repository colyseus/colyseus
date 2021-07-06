import EventEmitter from 'events';
import uWebSockets from 'uWebSockets.js';

import { getMessageBytes, Protocol, Client, ClientState, ISendOptions } from '@colyseus/core';
import { Schema } from '@colyseus/schema';

export class uWebSocketWrapper extends EventEmitter {
  constructor(public ws: uWebSockets.WebSocket) {
    super();
  }
}

export class uWebSocketClient implements Client {
  public sessionId: string;
  public state: ClientState = ClientState.JOINING;
  public _enqueuedMessages: any[] = [];

  constructor(
    public id: string,
    public ref: uWebSocketWrapper,
  ) {
    this.sessionId = id;
  }

  public send(messageOrType: any, messageOrOptions?: any | ISendOptions, options?: ISendOptions) {
    //
    // TODO: implement `options.afterNextPatch`
    //
    this.enqueueRaw(
      (messageOrType instanceof Schema)
        ? getMessageBytes[Protocol.ROOM_DATA_SCHEMA](messageOrType)
        : getMessageBytes[Protocol.ROOM_DATA](messageOrType, messageOrOptions),
      options,
    );
  }

  public enqueueRaw(data: ArrayLike<number>, options?: ISendOptions) {
    if (this.state === ClientState.JOINING) {
      // sending messages during `onJoin`.
      // - the client-side cannot register "onMessage" callbacks at this point.
      // - enqueue the messages to be send after JOIN_ROOM message has been sent
      this._enqueuedMessages.push(data);
      return;
    }

    this.raw(data, options);
  }

  public raw(data: ArrayLike<number>, options?: ISendOptions, cb?: (err?: Error) => void) {
    this.ref.ws.send(new Uint8Array(data), true, false);
  }

  public error(code: number, message: string = '', cb?: (err?: Error) => void) {
    this.raw(getMessageBytes[Protocol.ERROR](code, message), undefined, cb);
  }

  get readyState() {
    console.log("TRYING TO GET .readyState!!", this.ref.ws.readyState)
    return this.ref.ws.readyState;
  }

  public leave(code?: number, data?: string) {
    if (code !== undefined) {
      this.ref.ws.end(code, data);

    } else {
      this.ref.ws.close();
    }
  }

  public close(code?: number, data?: string) {
    console.warn('DEPRECATION WARNING: use client.leave() instead of client.close()');
    try {
      throw new Error();
    } catch (e) {
      console.log(e.stack);
    }
    this.leave(code, data);
  }

  public toJSON() {
    return { sessionId: this.sessionId, readyState: this.readyState };
  }
}

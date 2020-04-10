import WebSocket from 'ws';

import { Schema } from '@colyseus/schema';
import { getMessageBytes, Protocol, utf8Length } from '../../Protocol';
import { Client, ClientState, ISendOptions } from '../Transport';

const SEND_OPTS = { binary: true };

export class WebSocketClient implements Client {
  public sessionId: string;
  public state: ClientState = ClientState.JOINING;
  public _enqueuedMessages: any[] = [];

  constructor(
    public id: string,
    public ref: WebSocket,
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

  public raw(data: ArrayLike<number>, options?: ISendOptions) {
    if (this.ref.readyState !== WebSocket.OPEN) {
      console.warn('trying to send data to inactive client', this.sessionId);
      return;
    }

    this.ref.send(data, SEND_OPTS);
  }

  public error(code: number, message: string = '') {
    this.raw(getMessageBytes[Protocol.ERROR](code, message));
  }

  get readyState() {
    return this.ref.readyState;
  }

  public leave(code?: number, data?: string) {
    this.ref.close(code, data);
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

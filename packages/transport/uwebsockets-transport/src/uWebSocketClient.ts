import EventEmitter from 'events';
import uWebSockets from 'uWebSockets.js';

import { getMessageBytes, Protocol, Client, ClientState, ISendOptions, logger, debugMessage } from '@colyseus/core';
import { Schema } from '@colyseus/schema';

export class uWebSocketWrapper extends EventEmitter {
  constructor(public ws: uWebSockets.WebSocket) {
    super();
  }
}

export enum ReadyState {
  CONNECTING = 0,
  OPEN = 1,
  CLOSING = 2,
  CLOSED = 3,
}

export class uWebSocketClient implements Client {
  public sessionId: string;
  public state: ClientState = ClientState.JOINING;
  public readyState: number = ReadyState.OPEN;
  public _enqueuedMessages: any[] = [];
  public _afterNextPatchQueue;
  public _reconnectionToken: string;

  constructor(
    public id: string,
    public ref: uWebSocketWrapper,
  ) {
    this.sessionId = id;

    ref.on('close', () => this.readyState = ReadyState.CLOSED);
  }

  public sendBytes(type: any, bytes?: any | ISendOptions, options?: ISendOptions) {
    debugMessage("send bytes(to %s): '%s' -> %j", this.sessionId, type, bytes);

    this.enqueueRaw(
      getMessageBytes.raw(Protocol.ROOM_DATA_BYTES, type, undefined, bytes),
      options,
    );
  }

  public send(messageOrType: any, messageOrOptions?: any | ISendOptions, options?: ISendOptions) {
    debugMessage("send(to %s): '%s' -> %O", this.sessionId, messageOrType, messageOrOptions);

    this.enqueueRaw(
      (messageOrType instanceof Schema)
        ? getMessageBytes[Protocol.ROOM_DATA_SCHEMA](messageOrType)
        : getMessageBytes.raw(Protocol.ROOM_DATA, messageOrType, messageOrOptions),
      options,
    );
  }

  public enqueueRaw(data: ArrayLike<number>, options?: ISendOptions) {
    // use room's afterNextPatch queue
    if (options?.afterNextPatch) {
      this._afterNextPatchQueue.push([this, arguments]);
      return;
    }

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
    if (this.readyState !== ReadyState.OPEN) {
      logger.warn('trying to send data to inactive client', this.sessionId);
      return;
    }

    this.ref.ws.send(new Uint8Array(data), true, false);
  }

  public error(code: number, message: string = '', cb?: (err?: Error) => void) {
    this.raw(getMessageBytes[Protocol.ERROR](code, message), undefined, cb);
  }

  public leave(code?: number, data?: string) {
    if (this.readyState !== ReadyState.OPEN) {
      // connection already closed. ignore.
      return;
    }

    this.readyState = ReadyState.CLOSING;

    if (code !== undefined) {
      this.ref.ws.end(code, data);

    } else {
      this.ref.ws.close();
    }
  }

  public close(code?: number, data?: string) {
    logger.warn('DEPRECATION WARNING: use client.leave() instead of client.close()');
    try {
      throw new Error();
    } catch (e) {
      logger.info(e.stack);
    }
    this.leave(code, data);
  }

  public toJSON() {
    return { sessionId: this.sessionId, readyState: this.readyState };
  }
}

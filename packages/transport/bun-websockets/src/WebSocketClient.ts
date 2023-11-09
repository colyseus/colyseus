// <reference types="bun-types" />

// "bun-types" is currently conflicting with "ws" types.
// @ts-ignore
import { ServerWebSocket } from "bun";
import EventEmitter from 'events';

import { Protocol, Client, ClientState, ISendOptions, getMessageBytes, logger, debugMessage } from '@colyseus/core';
import { Schema } from '@colyseus/schema';

export class WebSocketWrapper extends EventEmitter {
  constructor(public ws: ServerWebSocket<any>) {
    super();
  }
}

export class WebSocketClient implements Client {
  public sessionId: string;
  public state: ClientState = ClientState.JOINING;
  public _enqueuedMessages: any[] = [];
  public _afterNextPatchQueue;
  public _reconnectionToken: string;

  constructor(
    public id: string,
    public ref: WebSocketWrapper,
  ) {
    this.sessionId = id;
  }

  public sendBytes(type: string | number, bytes: number[] | Uint8Array, options?: ISendOptions) {
    debugMessage("send bytes(to %s): '%s' -> %j", this.sessionId, type, bytes);

    this.enqueueRaw(
      getMessageBytes.raw(Protocol.ROOM_DATA_BYTES, type, undefined, bytes),
      options,
    );
  }

  public send(messageOrType: any, messageOrOptions?: any | ISendOptions, options?: ISendOptions) {
    debugMessage("send(to %s): '%s' -> %j", this.sessionId, messageOrType, messageOrOptions);

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
    // skip if client not open

    // WebSocket is globally available on Bun runtime
    // @ts-ignore
    if (this.ref.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    // FIXME: can we avoid creating a new buffer here?
    this.ref.ws.sendBinary(Buffer.from(data as unknown as ArrayBufferLike));
  }

  public error(code: number, message: string = '', cb?: (err?: Error) => void) {
    this.raw(getMessageBytes[Protocol.ERROR](code, message), undefined, cb);
  }

  get readyState() {
    return this.ref.ws.readyState;
  }

  public leave(code?: number, data?: string) {
    this.ref.ws.close(code, data);
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

// <reference types="bun-types" />

// "bun-types" is currently conflicting with "ws" types.
// @ts-ignore
import type { ServerWebSocket } from 'bun';
import EventEmitter from 'events';

import { Protocol, Client, ClientPrivate, ClientState, ISendOptions, getMessageBytes, logger, debugMessage } from '@colyseus/core';

export class WebSocketWrapper extends EventEmitter {
  constructor(public ws: ServerWebSocket<any>) {
    super();
  }
}

export class WebSocketClient implements Client, ClientPrivate {
  public sessionId: string;
  public state: ClientState = ClientState.JOINING;
  public reconnectionToken: string;

  public _enqueuedMessages: any[] = [];
  public _afterNextPatchQueue;
  public _reconnectionToken: string;
  public _joinedAt: number;

  constructor(
    public id: string,
    public ref: WebSocketWrapper,
  ) {
    this.sessionId = id;
  }

  public sendBytes(type: string | number, bytes: Buffer | Uint8Array, options?: ISendOptions) {
    debugMessage("send bytes(to %s): '%s' -> %j", this.sessionId, type, bytes);

    this.enqueueRaw(
      getMessageBytes.raw(Protocol.ROOM_DATA_BYTES, type, undefined, bytes),
      options,
    );
  }

  public send(messageOrType: any, messageOrOptions?: any | ISendOptions, options?: ISendOptions) {
    debugMessage("send(to %s): '%s' -> %j", this.sessionId, messageOrType, messageOrOptions);

    this.enqueueRaw(
      getMessageBytes.raw(Protocol.ROOM_DATA, messageOrType, messageOrOptions),
      options,
    );
  }

  public enqueueRaw(data: Uint8Array | Buffer, options?: ISendOptions) {
    // use room's afterNextPatch queue
    if (options?.afterNextPatch) {
      this._afterNextPatchQueue.push([this, [data]]);
      return;
    }

    if (this.state === ClientState.JOINING) {
      // sending messages during `onJoin`.
      // - the client-side cannot register "onMessage" callbacks at this point.
      // - enqueue the messages to be send after JOIN_ROOM message has been sent
      // - create a new buffer for enqueued messages, as the underlying buffer might be modified
      this._enqueuedMessages.push(data);
      return;
    }

    this.raw(data, options);
  }

  public raw(data: Uint8Array | Buffer, options?: ISendOptions, cb?: (err?: Error) => void) {
    // skip if client not open

    // WebSocket is globally available on Bun runtime
    // @ts-ignore
    if (this.ref.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    // FIXME: can we avoid creating a new buffer here?
    this.ref.ws.sendBinary(data);
  }

  public error(code: number, message: string = '', cb?: (err?: Error) => void) {
    this.raw(getMessageBytes[Protocol.ERROR](code, message));

    if (cb) {
      // (same API as "ws" transport)
      setTimeout(cb, 1);
    }
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

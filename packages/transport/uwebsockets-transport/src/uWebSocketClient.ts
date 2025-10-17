import EventEmitter from 'events';
import uWebSockets from 'uWebSockets.js';

import { getMessageBytes, Protocol, type Client, type ClientPrivate, ClientState, type ISendOptions, logger, debugMessage } from '@colyseus/core';

export class uWebSocketWrapper extends EventEmitter {
  public ws: uWebSockets.WebSocket<any>;
  constructor(ws: uWebSockets.WebSocket<any>) {
    super();
    this.ws = ws;
  }
}

export const ReadyState = {
  CONNECTING: 0,
  OPEN: 1,
  CLOSING: 2,
  CLOSED: 3,
} as const;
export type ReadyState = (typeof ReadyState)[keyof typeof ReadyState];

export class uWebSocketClient implements Client, ClientPrivate {
  '~messages': any;

  public id: string;
  public _ref: uWebSocketWrapper;

  public sessionId: string;
  public state: ClientState = ClientState.JOINING;
  public readyState: number = ReadyState.OPEN;
  public reconnectionToken: string;

  public _enqueuedMessages: any[] = [];
  public _afterNextPatchQueue;
  public _reconnectionToken: string;
  public _joinedAt: number;

  constructor(id: string, _ref: uWebSocketWrapper) {
    this.id = this.sessionId = id;
    this._ref = _ref;
    _ref.on('close', () => this.readyState = ReadyState.CLOSED);
  }

  get ref() { return this._ref; }
  set ref(_ref: uWebSocketWrapper) {
    this._ref = _ref;
    this.readyState = ReadyState.OPEN;
  }

  public sendBytes(type: string | number, bytes: Buffer | Uint8Array, options?: ISendOptions) {
    debugMessage("send bytes(to %s): '%s' -> %j", this.sessionId, type, bytes);

    this.enqueueRaw(
      getMessageBytes.raw(Protocol.ROOM_DATA_BYTES, type, undefined, bytes),
      options,
    );
  }

  public send(messageOrType: any, messageOrOptions?: any | ISendOptions, options?: ISendOptions) {
    debugMessage("send(to %s): '%s' -> %O", this.sessionId, messageOrType, messageOrOptions);

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
    if (this.readyState !== ReadyState.OPEN) {
      return;
    }

    this._ref.ws.send(data, true, false);
  }

  public error(code: number, message: string = '', cb?: (err?: Error) => void) {
    this.raw(getMessageBytes[Protocol.ERROR](code, message));

    if (cb) {
      // delay callback execution - uWS doesn't acknowledge when the message was sent
      // (same API as "ws" transport)
      setTimeout(cb, 1);
    }
  }

  public leave(code?: number, data?: string) {
    if (this.readyState !== ReadyState.OPEN) {
      // connection already closed. ignore.
      return;
    }

    this.readyState = ReadyState.CLOSING;

    if (code !== undefined) {
      this._ref.ws.end(code, data);

    } else {
      this._ref.ws.close();
    }
  }

  public close(code?: number, data?: string) {
    logger.warn('DEPRECATION WARNING: use client.leave() instead of client.close()');
    try {
      throw new Error();
    } catch (e: any) {
      logger.info(e.stack);
    }
    this.leave(code, data);
  }

  public toJSON() {
    return { sessionId: this.sessionId, readyState: this.readyState };
  }
}

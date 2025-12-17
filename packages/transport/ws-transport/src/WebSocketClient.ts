import WebSocket from 'ws';

import {
  Protocol, ClientState, getMessageBytes, logger, debugMessage,
  type Client, type ClientPrivate, type ISendOptions,
} from '@colyseus/core';

const SEND_OPTS = { binary: true };

export class WebSocketClient implements Client, ClientPrivate {
  '~messages': any;

  public id: string;
  public ref: WebSocket;

  public sessionId: string;
  public state: ClientState = ClientState.JOINING;
  public reconnectionToken: string;

  public _enqueuedMessages: any[] = [];
  public _afterNextPatchQueue;
  public _reconnectionToken: string;
  public _joinedAt;
  public _numMessagesLastSecond: number = 0;
  public _lastMessageTime: number = 0;

  constructor(id: string, ref: WebSocket) {
    this.sessionId = this.id = id;
    this.ref = ref;
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
    if (this.ref.readyState !== WebSocket.OPEN) {
      return;
    }

    this.ref.send(data, SEND_OPTS, cb);
  }

  public error(code: number, message: string = '', cb?: (err?: Error) => void) {
    this.raw(getMessageBytes[Protocol.ERROR](code, message), undefined, cb);
  }

  get readyState() {
    return this.ref.readyState;
  }

  public leave(code?: number, data?: string) {
    this.ref.close(code, data);
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

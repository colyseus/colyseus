import WebSocket from 'ws';

import { Protocol, Client, ClientState, ISendOptions, getMessageBytes, logger, debugMessage } from '@colyseus/core';
import { Schema } from '@colyseus/schema';

const SEND_OPTS = { binary: true };

export class WebSocketClient implements Client {
  public sessionId: string;
  public state: ClientState = ClientState.JOINING;
  public _enqueuedMessages: any[] = [];
  public _afterNextPatchQueue;
  public _reconnectionToken: string;

  constructor(
    public id: string,
    public ref: WebSocket,
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
    } catch (e) {
      logger.info(e.stack);
    }
    this.leave(code, data);
  }

  public toJSON() {
    return { sessionId: this.sessionId, readyState: this.readyState };
  }
}

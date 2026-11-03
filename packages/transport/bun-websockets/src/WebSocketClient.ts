// <reference types="bun-types" />

// "bun-types" is currently conflicting with "ws" types.
// @ts-ignore
import type { ServerWebSocket } from 'bun';
import EventEmitter from 'events';

import { Protocol, type Client, type ClientPrivate, ClientState, type ISendOptions, getMessageBytes, logger, debugMessage, enqueueClientRaw } from '@colyseus/core';

export class WebSocketWrapper extends EventEmitter {
  public ws: ServerWebSocket<any>;

  constructor(ws: ServerWebSocket<any>) {
    super();
    this.ws = ws;
  }
}

export class WebSocketClient implements Client, ClientPrivate {
  '~messages': any;

  public id: string;
  public ref: WebSocketWrapper;

  public sessionId: string;
  public state: ClientState = ClientState.JOINING;
  public reconnectionToken: string;

  public _enqueuedMessages: any[] = [];
  public _reconnectionToken: string;
  public _joinedAt: number;

  constructor(id: string, ref: WebSocketWrapper,) {
    this.id = this.sessionId = id;
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
    enqueueClientRaw(this, data, options);
  }

  public raw(data: Uint8Array | Buffer, options?: ISendOptions, cb?: (err?: Error) => void) {
    // skip if client not open

    // WebSocket is globally available on Bun runtime
    // @ts-ignore
    if (this.ref.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    // corked: held until uncork() (the transport owns `data`, Client.raw)
    if (this._holding) {
      this._held.push(data);
      return;
    }

    // Bun's sendBinary requires an ArrayBufferView (Uint8Array, etc).
    // Ensure we don't pass a plain number[] array.
    this.ref.ws.sendBinary(ArrayBuffer.isView(data) ? data : new Uint8Array(data));
  }

  /** Frames held while corked (reused), and whether `raw` holds. */
  private _held: Array<Uint8Array | Buffer> = [];
  private _holding: boolean = false;
  /** Send what's held (`uncork()`'s cork callback, made once). */
  private _sendHeld = () => {
    const ws = this.ref.ws, held = this._held;
    for (let i = 0; i < held.length; i++) {
      ws.sendBinary(ArrayBuffer.isView(held[i]) ? held[i] : new Uint8Array(held[i]));
    }
  };

  /** Bun corks inside a callback (`ws.cork(cb)`), as uWS does: hold, then send them all in one. */
  public cork() {
    this._holding = true;
  }

  public uncork() {
    this._holding = false;
    const held = this._held;
    if (held.length === 0) { return; }
    try {
      // @ts-ignore
      if (this.ref.ws.readyState === WebSocket.OPEN) {
        const ws = this.ref.ws;
        // one frame is one write either way: send it as raw() would (a cork costs more than it saves)
        if (held.length === 1 || typeof ws.cork !== 'function') { this._sendHeld(); }
        else { ws.cork(this._sendHeld); }
      }
    } finally {
      held.length = 0;
    }
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
    } catch (e: any) {
      logger.info(e.stack);
    }
    this.leave(code, data);
  }

  public toJSON() {
    return { sessionId: this.sessionId, readyState: this.readyState };
  }
}

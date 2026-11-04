import EventEmitter from 'events';
import uWebSockets from 'uWebSockets.js';

import { getMessageBytes, Protocol, type Client, type ClientPrivate, ClientState, type ISendOptions, logger, debugMessage, enqueueClientRaw } from '@colyseus/core';

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
    enqueueClientRaw(this, data, options);
  }

  public raw(data: Uint8Array | Buffer, options?: ISendOptions, cb?: (err?: Error) => void) {
    // skip if client not open
    if (this.readyState !== ReadyState.OPEN) {
      return;
    }

    // corked: held until uncork() (the transport owns `data`, Client.raw)
    if (this._holding) {
      this._held.push(data);
      return;
    }

    try {
      this._ref.ws.send(data, true, false);
    } catch (e: any) {
      // uWS throws "Invalid access of closed uWS.WebSocket" if the socket
      // closed between the readyState check and the send() call.
      this.readyState = ReadyState.CLOSED;
    }
  }

  /** Frames held while corked (reused), and whether `raw` holds. */
  private _held: Array<Uint8Array | Buffer> = [];
  private _holding: boolean = false;
  /** `uncork()`'s cork callback, made once (none allocated a tick). */
  private _sendHeld = () => {
    const ws = this._ref.ws, held = this._held;
    for (let i = 0; i < held.length; i++) { ws.send(held[i], true, false); }
  };

  /**
   * uWS corks only inside a callback (`ws.cork(cb)`: every send in it goes out
   * as one syscall), so hold the frames here and send them all in one cork on
   * `uncork()`. Outside a cork, each send is a syscall of its own.
   */
  public cork() {
    this._holding = true;
  }

  public uncork() {
    this._holding = false;
    const held = this._held;
    if (held.length === 0) { return; }
    try {
      if (this.readyState === ReadyState.OPEN) {
        // one frame is one write either way: send it as raw() would (a cork costs more than it saves)
        if (held.length === 1) { this._ref.ws.send(held[0], true, false); }
        else { this._ref.ws.cork(this._sendHeld); }
      }
    } catch (e: any) {
      // closed between the readyState check and the sends (see raw)
      this.readyState = ReadyState.CLOSED;
    } finally {
      held.length = 0;
    }
  }

  public error(code: number, message: string = '', cb?: (err?: Error) => void) {
    this.raw(getMessageBytes[Protocol.ERROR](code, message));

    if (cb) {
      // delay callback execution - uWS doesn't acknowledge when the message was sent
      // (same API as "ws" transport)
      process.nextTick(cb);
    }
  }

  public leave(code?: number, data?: string) {
    if (this.readyState !== ReadyState.OPEN) {
      // connection already closed. ignore.
      return;
    }

    this.uncork(); // what a write window held goes out before the close

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

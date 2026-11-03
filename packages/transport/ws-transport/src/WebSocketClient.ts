import WebSocket from 'ws';

import {
  Protocol, ClientState, getMessageBytes, logger, debugMessage, enqueueClientRaw,
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
  public _reconnectionToken: string;
  public _joinedAt;
  public _numMessagesLastSecond: number = 0;
  public _messageCountResetsAt: number = 0;
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
    enqueueClientRaw(this, data, options);
  }

  public raw(data: Uint8Array | Buffer, options?: ISendOptions, cb?: (err?: Error) => void) {
    this.ref.send(data, SEND_OPTS, cb);
  }

  /** The socket `cork()` held (the one to release, whatever `ref` is by then). */
  private _corkedSocket: { cork(): void; uncork(): void } | undefined = undefined;

  /**
   * Hold the TCP socket's writes: `ws` still frames each message as it's sent
   * (in order, into the socket's buffer), and `uncork()` writes them all in one
   * go. Frames from every path (patches, messages, replies) keep their order.
   */
  public cork() {
    // `_socket`: the net.Socket `ws` writes to (not in its types)
    const socket = (this.ref as any)._socket;
    if (socket) { socket.cork(); this._corkedSocket = socket; }
  }

  public uncork() {
    const socket = this._corkedSocket;
    if (socket) { this._corkedSocket = undefined; socket.uncork(); }
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

// import WebSocket from 'ws';

import { Protocol, Client, ClientState, ISendOptions, getMessageBytes, logger, debugMessage } from '@colyseus/core';
import { WebTransportSession } from '@fails-components/webtransport';
import { EventEmitter } from 'stream';

export class H3Client implements Client {
  public id: string;
  public ref: EventEmitter = new EventEmitter();

  public sessionId: string;
  public state: ClientState = ClientState.JOINING;
  public _enqueuedMessages: any[] = [];
  public _afterNextPatchQueue;
  public _reconnectionToken: string;

  // TODO: remove readyState
  public readyState: number;

  private _bidiReader: any;
  private _bidiWriter: any;

  private _datagramReader: any;
  private _datagramWriter: any;

  constructor(
    private _wtSession: WebTransportSession,
    onInitialMessage: (message: any) => void
  ) {

    _wtSession.ready.then(() => {

      _wtSession.createBidirectionalStream().then((bidi) => {
        this._bidiReader = bidi.readable.getReader();
        this._bidiWriter = bidi.writable.getWriter();

        this._bidiReader.read().then((read: any) => onInitialMessage(read.value));

        this._bidiReader.closed.catch((e: any) => {/* console.log("writer closed with error!", e) */});
        this._bidiWriter.closed.catch((e: any) => {/* console.log("reader closed with error!", e) */});

        this.readyState = 1;

        this.ref.emit('open');

        this.readIncoming();
        this.readIncomingUnreliable();

      }).catch((e: any) => {
        console.log("failed to create bidirectional stream!", e);
        this._close();
      });

      // // reading datagrams
      this._datagramReader = _wtSession.datagrams.readable.getReader();
      this._datagramReader.closed.catch((e: any) =>
        console.log("datagram reader closed with error!", e));

    }).catch((e: any) => {
      console.error("session failed to open =>", e);
      this._close();
    });

    _wtSession.closed
      .then((e) => this.leave(Protocol.WS_CLOSE_NORMAL, e.reason))
      .catch((e: any) => this.leave(Protocol.WS_CLOSE_WITH_ERROR, e.reason))
      .finally(() => this._close());

  }

  public sendBytes(type: string | number, bytes: number[] | Uint8Array, options?: ISendOptions) {
    debugMessage("send bytes(to %s): '%s' -> %j", this.sessionId, type, bytes);

    this.enqueueRaw(
      getMessageBytes.raw(Protocol.ROOM_DATA_BYTES, type, undefined, bytes),
      options,
    );
  }

  public sendDatagram(bytes: number[] | Uint8Array) {
    if (!this._datagramWriter) {
      this._datagramWriter = this._wtSession.datagrams.writable.getWriter();
      this._datagramWriter.closed
        .then(() => console.log("datagram writer closed successfully!"))
        .catch((e: any) => console.log("datagram writer closed with error!", e));
    }
    this._datagramWriter.write(bytes);
  }

  public async readIncoming() {
    let read = undefined;

    while (this.readyState === 1) {
      try {
        read = await this._bidiReader.read();

      } catch (e) {
        return;
      }

      if (read.done) {
        return;
      }

      this.ref.emit('message', Array.from(read.value));
    }
  }

  public async readIncomingUnreliable() {
    let read = undefined;

    while (this.readyState === 1) {
      try {
        read = await this._datagramReader.read();
      } catch (e) {
        return;
      }

      if (read.done) {
        return;
      }

      this.ref.emit('message', Array.from(read.value));
    }
  }

  public send(messageOrType: any, messageOrOptions?: any | ISendOptions, options?: ISendOptions) {
    debugMessage("send(to %s): '%s' -> %j", this.sessionId, messageOrType, messageOrOptions);

    this.enqueueRaw(
      getMessageBytes.raw(Protocol.ROOM_DATA, messageOrType, messageOrOptions),
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
    if (this.readyState !== 1) {// OPEN
      return;
    }

    this._bidiWriter.write(new Uint8Array(data).buffer);
  }

  public error(code: number, message: string = '', cb?: (err?: Error) => void) {
    this.raw(getMessageBytes[Protocol.ERROR](code, message), undefined, cb);
  }

  public leave(code?: number, data?: string) {
    this.readyState = 2; // CLOSING;
    this._wtSession.close({ reason: data, closeCode: code });
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

  private _close() {
    this.readyState = 3; // CLOSED;
    this.ref.emit('close');
    this.ref.removeAllListeners();
  }
}

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

  constructor(private _wtSession: WebTransportSession) {
    _wtSession.closed
      .then(() => console.log("session closed => successfully"))
      .catch((e: any) => console.error("session closed =>", e))
      .finally(() => this._close());

    _wtSession.ready.then(() => {

      _wtSession.createBidirectionalStream().then((bidi) => {
        // @ts-ignore
        this._bidiReader = bidi.readable.getReader();
        // @ts-ignore
        this._bidiWriter = bidi.writable.getWriter();

        this._bidiReader.closed.catch((e: any) => console.log("writer closed with error!", e));
        this._bidiWriter.closed.catch((e: any) => console.log("writer closed with error!", e));

        this.ref.emit('open');

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
  }

  // constructor(
  //   public id: string,
  //   public ref: WebSocket,
  // ) {
  //   this.sessionId = id;
  // }

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

  public async readDatagram() {
    const read = await this._datagramReader.read();
    return read.value;
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
    if (this.readyState !== 1) {
      return;
    }

    this._bidiWriter.write(data);
  }

  public error(code: number, message: string = '', cb?: (err?: Error) => void) {
    this.raw(getMessageBytes[Protocol.ERROR](code, message), undefined, cb);
  }

  public leave(code?: number, data?: string) {
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
    this.readyState = 3; // WebSocket.CLOSED;
    this.ref.emit('close');
    this.ref.removeAllListeners();
  }
}

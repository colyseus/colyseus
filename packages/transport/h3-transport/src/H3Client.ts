// import WebSocket from 'ws';

import type { ReadableStreamDefaultReader, WritableStreamDefaultWriter } from 'stream/web';
import { Protocol, Client, ClientState, ISendOptions, getMessageBytes, logger, debugMessage, ClientPrivate } from '@colyseus/core';
import { WebTransportSession } from '@fails-components/webtransport';
import { EventEmitter } from 'events';
import { type Iterator, decode, encode } from '@colyseus/schema';

const lengthPrefixBuffer = new Uint8Array(9); // 9 bytes is the maximum length of a length prefix

export class H3Client implements Client, ClientPrivate {
  public id: string;
  public ref: EventEmitter = new EventEmitter();

  public sessionId: string;
  public state: ClientState = ClientState.JOINING;
  public reconnectionToken: string;
  public _enqueuedMessages: any[] = [];
  public _afterNextPatchQueue;
  public _joinedAt;

  // TODO: remove readyState
  public readyState: number;

  private _bidiReader: ReadableStreamDefaultReader<Uint8Array>;
  private _bidiWriter: WritableStreamDefaultWriter<Uint8Array>;

  private _datagramReader: ReadableStreamDefaultReader<Uint8Array>;
  private _datagramWriter: WritableStreamDefaultWriter<Uint8Array>;

  constructor(
    private _wtSession: WebTransportSession,
    onInitialMessage: (message: any) => void
  ) {

    _wtSession.ready.then(() => {
      _wtSession.createBidirectionalStream().then((bidi) => {
        // @ts-ignore
        this._bidiReader = bidi.readable.getReader();
        // @ts-ignore
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

      // reading datagrams
      // @ts-ignore
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

  public sendBytes(type: string | number, bytes: Uint8Array | Buffer, options?: ISendOptions) {
    debugMessage("send bytes(to %s): '%s' -> %j", this.sessionId, type, bytes);

    this.enqueueRaw(
      getMessageBytes.raw(Protocol.ROOM_DATA_BYTES, type, undefined, bytes),
      options,
    );
  }

  public sendDatagram(data: Uint8Array | Buffer) {
    if (!this._datagramWriter) {
      this._datagramWriter = this._wtSession.datagrams.writable.getWriter();
      this._datagramWriter.closed
        .then(() => console.log("datagram writer closed successfully!"))
        .catch((e: any) => console.log("datagram writer closed with error!", e));
    }

    // include length of message, as the reader may receive multiple messages at once
    const prefixLength = encode.number(lengthPrefixBuffer, data.length, { offset: 0 });
    const dataWithPrefixedLength = new Uint8Array(prefixLength + data.length);
    dataWithPrefixedLength.set(lengthPrefixBuffer.subarray(0, prefixLength), 0);
    dataWithPrefixedLength.set(data, prefixLength);

    this._datagramWriter.write(dataWithPrefixedLength);
  }

  public async readIncoming() {
    let read = undefined;

    while (this.readyState === 1) {
      try {
        read = await this._bidiReader.read();

        //
        // a single read may contain multiple messages
        // each message is prefixed with its length
        //

        const messages = read.value;
        const it: Iterator = { offset: 0 };
        do {
          //
          // QUESTION: should we buffer the message in case it's not fully read?
          //

          const length = decode.number(messages, it);
          this.ref.emit('message', messages.subarray(it.offset, it.offset + length));
          it.offset += length;
        } while (it.offset < messages.length);

      } catch (e) {
        return;
      }

      if (read.done) {
        return;
      }

    }
  }

  public async readIncomingUnreliable() {
    let read = undefined;

    while (this.readyState === 1) {
      try {
        read = await this._datagramReader.read();

        //
        // a single read may contain multiple messages
        // each message is prefixed with its length
        //

        const messages = read.value;
        const it: Iterator = { offset: 0 };
        do {
          //
          // QUESTION: should we buffer the message in case it's not fully read?
          //

          const length = decode.number(messages, it);
          this.ref.emit('message', messages.subarray(it.offset, it.offset + length));
          it.offset += length;
        } while (it.offset < messages.length);

      } catch (e) {
        return;
      }

      if (read.done) {
        return;
      }
    }
  }

  public send(messageOrType: any, messageOrOptions?: any | ISendOptions, options?: ISendOptions) {
    debugMessage("send(to %s): '%s' -> %j", this.sessionId, messageOrType, messageOrOptions);

    this.enqueueRaw(
      getMessageBytes.raw(Protocol.ROOM_DATA, messageOrType, messageOrOptions),
      options,
    );
  }

  public enqueueRaw(data: Buffer | Uint8Array, options?: ISendOptions) {
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

  public raw(data: Buffer | Uint8Array, options?: ISendOptions, cb?: (err?: Error) => void) {
    // skip if client not open
    if (this.readyState !== 1) {// OPEN
      return;
    }

    // include length of message, as the reader may receive multiple messages at once
    const prefixLength = encode.number(lengthPrefixBuffer, data.length, { offset: 0 });
    const dataWithPrefixedLength = new Uint8Array(prefixLength + data.length);
    dataWithPrefixedLength.set(lengthPrefixBuffer.subarray(0, prefixLength), 0);
    dataWithPrefixedLength.set(data, prefixLength);

    this._bidiWriter.write(dataWithPrefixedLength);
  }

  public error(code: number, message: string = '', cb?: (err?: Error) => void) {
    this.raw(getMessageBytes[Protocol.ERROR](code, message), undefined, cb);
  }

  public leave(code?: number, data?: string) {
    this.readyState = 2; // CLOSING;
    this._wtSession.close({ reason: data || "", closeCode: code });
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

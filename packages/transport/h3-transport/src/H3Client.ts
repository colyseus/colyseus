// import WebSocket from 'ws';

import type { ReadableStreamDefaultReader, WritableStreamDefaultWriter } from 'stream/web';
import { Protocol, type Client, ClientState, type ISendOptions, getMessageBytes, logger, debugMessage, type ClientPrivate, CloseCode } from '@colyseus/core';
import { type WebTransportSession } from '@fails-components/webtransport';
import { EventEmitter } from 'events';
import { type Iterator, decode, encode } from '@colyseus/schema';

const lengthPrefixBuffer = Buffer.alloc(9); // 9 bytes is the maximum length of a length prefix

// 9 bytes is the maximum length of a variable-length integer prefix
const MAX_LENGTH_PREFIX_BYTES = 9;

/**
 * Reassembles length-prefixed frames from arbitrary byte chunks.
 *
 * A single WebTransport `reader.read()` may:
 *   - deliver multiple whole frames in one chunk
 *   - split a frame (or its length prefix) across multiple chunks
 *
 * This reassembler buffers partial data across reads so each dispatched
 * frame is exactly one complete message.
 */
export class FrameReassembler {
  private pending: Uint8Array = new Uint8Array(0);

  push(chunk: Uint8Array | undefined): Uint8Array[] {
    if (!chunk || chunk.byteLength === 0) { return []; }

    const bytes = (this.pending.byteLength === 0)
      ? chunk
      : concatBytes(this.pending, chunk);

    const frames: Uint8Array[] = [];
    let offset = 0;

    while (offset < bytes.byteLength) {
      const it: Iterator = { offset };
      let length: number;

      try {
        length = decode.number(bytes as any, it);
      } catch (e) {
        // length prefix is incomplete — wait for more bytes
        if (bytes.byteLength - offset <= MAX_LENGTH_PREFIX_BYTES) { break; }
        throw e;
      }

      const frameEnd = it.offset + length;
      if (frameEnd > bytes.byteLength) {
        // payload is incomplete — wait for more bytes
        break;
      }

      frames.push(bytes.subarray(it.offset, frameEnd));
      offset = frameEnd;
    }

    this.pending = (offset < bytes.byteLength)
      ? bytes.slice(offset)
      : new Uint8Array(0);

    return frames;
  }
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.byteLength + b.byteLength);
  out.set(a, 0);
  out.set(b, a.byteLength);
  return out;
}

export class H3Client implements Client, ClientPrivate {
  '~messages': any;

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

  private _wtSession: WebTransportSession;

  private _bidiReader: ReadableStreamDefaultReader<Uint8Array>;
  private _bidiWriter: WritableStreamDefaultWriter<Uint8Array>;

  private _datagramReader: ReadableStreamDefaultReader<Uint8Array>;
  private _datagramWriter: WritableStreamDefaultWriter<Uint8Array>;

  private _bidiReassembler = new FrameReassembler();
  private _datagramReassembler = new FrameReassembler();

  constructor(
    _wtSession: WebTransportSession,
    onInitialMessage: (message: any) => void
  ) {
    this._wtSession = _wtSession;

    _wtSession.ready.then(() => {
      _wtSession.createBidirectionalStream().then((bidi) => {
        this._bidiReader = bidi.readable.getReader();
        this._bidiWriter = bidi.writable.getWriter();

        this._bidiReader.read().then((read) => onInitialMessage(read.value));

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
      this._datagramReader = _wtSession.datagrams.readable.getReader();
      this._datagramReader.closed.catch((e: any) =>
        console.log("datagram reader closed with error!", e));

    }).catch((e: any) => {
      console.error("session failed to open =>", e);
      this._close();
    });

    _wtSession.closed
      .then((e) => this.leave(CloseCode.NORMAL_CLOSURE, e.reason))
      .catch((e: any) => this.leave(CloseCode.WITH_ERROR, e.reason))
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
        // a read may also deliver a partial frame; buffer across reads
        //
        for (const frame of this._bidiReassembler.push(read.value)) {
          this.ref.emit('message', frame);
        }

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
        // a read may also deliver a partial frame; buffer across reads
        //
        for (const frame of this._datagramReassembler.push(read.value)) {
          this.ref.emit('message', frame);
        }

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

    if (this.state !== ClientState.JOINED) {
      // sending messages during `onJoin` or `onReconnect`.
      // - the client-side cannot register "onMessage" callbacks at this point.
      // - enqueue the messages to be send after JOIN_ROOM message has been sent
      this._enqueuedMessages?.push(data);
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
    } catch (e: any) {
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

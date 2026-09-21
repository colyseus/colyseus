// import WebSocket from 'ws';

import type { ReadableStreamDefaultReader, ReadableStreamReadResult, WritableStreamDefaultWriter } from 'stream/web';
import { Protocol, type Client, ClientState, type ISendOptions, getMessageBytes, logger, debugMessage, type ClientPrivate, CloseCode, enqueueClientRaw } from '@colyseus/core';
import type { WebTransportSession } from '@fails-components/webtransport';
import { EventEmitter } from 'events';
import { type Iterator, decode, encode } from '@colyseus/schema';

const lengthPrefixBuffer = Buffer.alloc(9); // 9 bytes is the maximum length of a length prefix

// Test-only datagram loss injectors: drop this fraction [0..1] of unreliable
// datagrams (whole packet), to measure how well each direction recovers.
// Separate per direction so a test can isolate one — H3_DATAGRAM_LOSS covers
// INCOMING input (all ring slots in the packet), H3_DATAGRAM_LOSS_OUT covers
// OUTGOING state patches. 0 = off.
const DATAGRAM_LOSS = Number(process.env.H3_DATAGRAM_LOSS ?? 0);
const DATAGRAM_LOSS_OUT = Number(process.env.H3_DATAGRAM_LOSS_OUT ?? 0);

// 9 bytes is the maximum length of a variable-length integer prefix
const MAX_LENGTH_PREFIX_BYTES = 9;

type Channel = 'reliable' | 'unreliable';

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
      // the read loop reports the failure; this only keeps the rejection handled
      this._datagramReader.closed.catch(() => {});

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

  public rawUnreliable(data: Uint8Array | Buffer, options?: ISendOptions, cb?: (err?: Error) => void) {
    // skip if client not open
    if (this.readyState !== 1) {// OPEN
      return;
    }

    const datagrams = this._wtSession.datagrams as any;

    if (!this._datagramWriter) {
      // Prefer `createWritable()` (non-deprecated in @fails-components 1.6); fall
      // back to the standard `datagrams.writable` property for other runtimes.
      this._datagramWriter = (datagrams.createWritable ? datagrams.createWritable() : datagrams.writable).getWriter();

      this._datagramWriter.closed
        .then(() => console.log("datagram writer closed successfully!"))
        .catch((e: any) => console.log("datagram writer closed with error!", e));
    }

    // include length of message, as the reader may receive multiple messages at once
    const prefixLength = encode.number(lengthPrefixBuffer, data.length, { offset: 0 });
    const dataWithPrefixedLength = new Uint8Array(prefixLength + data.length);
    dataWithPrefixedLength.set(lengthPrefixBuffer.subarray(0, prefixLength), 0);
    dataWithPrefixedLength.set(data, prefixLength);

    // Drop rather than split an oversized payload. A datagram is atomic, so the
    // receiver's reassembler only ever holds whole frames; a frame spread over
    // two datagrams would desync its framing for good the first time one is lost.
    const maxSize = datagrams.maxDatagramSize;
    if (maxSize > 0 && dataWithPrefixedLength.byteLength > maxSize) {
      logger.warn(
        `@colyseus/h3-transport: dropping a ${dataWithPrefixedLength.byteLength}-byte` +
        ` unreliable frame — over the ${maxSize}-byte datagram limit.`
      );
      return;
    }

    // Test-only: drop outgoing datagrams to simulate loss toward the client.
    if (DATAGRAM_LOSS_OUT > 0 && Math.random() < DATAGRAM_LOSS_OUT) { return; }

    this._datagramWriter.write(dataWithPrefixedLength);
  }

  public readIncoming() {
    return this._readLoop(this._bidiReader, this._bidiReassembler, 'reliable');
  }

  public readIncomingUnreliable() {
    return this._readLoop(this._datagramReader, this._datagramReassembler, 'unreliable', DATAGRAM_LOSS);
  }

  /** @param loss test-only fraction [0..1] of whole reads to drop, simulating packet loss. */
  private async _readLoop(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    reassembler: FrameReassembler,
    channel: Channel,
    loss = 0,
  ) {
    while (this.readyState === 1) {
      let read: ReadableStreamReadResult<Uint8Array>;

      try {
        read = await reader.read();

      } catch (e) {
        this._onChannelFailure(channel, e);
        return;
      }

      if (read.done) { return; }

      if (loss > 0 && read.value && Math.random() < loss) { continue; }

      //
      // a single read may contain multiple messages
      // each message is prefixed with its length
      // a read may also deliver a partial frame; buffer across reads
      //
      for (const frame of reassembler.push(read.value)) {
        this.ref.emit('message', frame);
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
    enqueueClientRaw(this, data, options);
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
    // `closed` can settle after a failure path already ran _close(); don't reopen
    if (this.readyState === 3) { return; }
    this.readyState = 2; // CLOSING;
    try {
      this._wtSession.close({ reason: data || "", closeCode: code });
    } catch (e) {
      // already closing or failed — there is nothing left to close
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

  /**
   * Ends the session after a read loop failed.
   *
   * A rejected `read()` is the end of that channel, never a hiccup: an errored
   * ReadableStream stays errored, so retrying re-raises the same rejection (a
   * busy loop) and a fresh reader taken off the same stream is born errored.
   * With nothing to recover, the only alternative to closing is a client that
   * still reports itself OPEN while the room can no longer hear it.
   */
  private _onChannelFailure(channel: Channel, e: any) {
    // A session marks itself closed/failed *before* erroring its streams, so an
    // ordinary teardown is already visible here and passes silently.
    if (this.readyState !== 1 || this._wtSession.state !== 'connected') { return; }

    logger.warn(
      `@colyseus/h3-transport: '${this.sessionId}' stopped reading its ${channel} channel` +
      ` while the session was open (${e?.message || e}) — dropping the client.`
    );

    this.leave(CloseCode.WITH_ERROR, `${channel} channel failed`);

    // don't wait on the session's `closed` chain — a broken session may never settle it
    this._close();
  }

  private _close() {
    this.readyState = 3; // CLOSED;
    this.ref.emit('close');
    this.ref.removeAllListeners();
  }
}

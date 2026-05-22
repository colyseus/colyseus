import { Packr, RESERVE_START_SPACE } from 'msgpackr';
import { encode, type Iterator } from '@colyseus/schema';
import { Protocol } from '@colyseus/shared-types';

// Inter-process communication protocol
export const IpcProtocol = {
  SUCCESS: 0,
  ERROR: 1,
  TIMEOUT: 2,
} as const;
export type IpcProtocol = typeof IpcProtocol[keyof typeof IpcProtocol];

const packr = new Packr({
  useRecords: false, // interop with non-msgpackr decoders
});

// Buffer for assembling outgoing frames; keeps us off msgpackr's internal
// buffer so `core` can use the upstream package directly.
let frameBuffer = Buffer.allocUnsafe(8192);

// Grow to `capacity`, preserving written bytes (`rawMessage` writes the header
// before the payload size is known).
function ensureFrameCapacity(capacity: number) {
  if (capacity > frameBuffer.byteLength) {
    const next = Buffer.allocUnsafe(capacity);
    frameBuffer.copy(next);
    frameBuffer = next;
  }
}

// Shared across calls to avoid a per-call allocation on the hot send path.
// Safe: encode.* mutate `.offset` in place and never re-enter this module.
const it: Iterator = { offset: 0 };

export const getMessageBytes = {
  /**
   * Build the JOIN_ROOM payload.
   *
   * Wire layout:
   *   [JOIN_ROOM byte][rt-len][rt][sid-len][sid][stateReflectionLen varint][stateReflection][...sections]
   *
   * The varint length prefix on `stateReflection` is required because the
   * schema decoder on the SDK side runs `while (offset < bytes.byteLength)`
   * — without a boundary it consumes past the state reflection into the
   * trailing tagged-section bytes, producing "definition mismatch" warnings.
   * Length is `0` when no state reflection is present.
   *
   * Each trailing section is `[tag (uint8)][length (varint)][payload]`. The
   * SDK skips unknown tags via `length`, so new sections can be added without
   * breaking older clients. See {@link HandshakeSection} in shared-types.
   */
  [Protocol.JOIN_ROOM]: (
    reconnectionToken: string,
    serializerId: string,
    handshake?: Uint8Array,
    extraSections?: Array<{ tag: number; bytes: Uint8Array }>,
  ) => {
    const reconnectionTokenLength = Buffer.byteLength(reconnectionToken, "utf8");
    const serializerIdLength = Buffer.byteLength(serializerId, "utf8");
    let handshakeLength = handshake?.byteLength || 0;

    // per section: 1 tag byte + 9 (max varint) + payload
    let extraLength = 0;
    if (extraSections !== undefined) {
      for (let i = 0; i < extraSections.length; i++) {
        extraLength += 1 + 9 + extraSections[i].bytes.byteLength;
      }
    }

    // capacity: header + 9 (handshake-len varint) + handshake + sections
    ensureFrameCapacity(1 + 1 + reconnectionTokenLength + 1 + serializerIdLength + 9 + handshakeLength + extraLength);

    it.offset = 1;
    frameBuffer[0] = Protocol.JOIN_ROOM;

    frameBuffer[it.offset++] = reconnectionTokenLength;
    encode.utf8Write(frameBuffer, reconnectionToken, it);

    frameBuffer[it.offset++] = serializerIdLength;
    encode.utf8Write(frameBuffer, serializerId, it);

    encode.number(frameBuffer, handshakeLength, it);
    if (handshakeLength > 0) {
      frameBuffer.set(handshake, it.offset);
      it.offset += handshakeLength;
    }

    if (extraSections !== undefined) {
      for (let i = 0; i < extraSections.length; i++) {
        const section = extraSections[i];
        frameBuffer[it.offset++] = section.tag;
        encode.number(frameBuffer, section.bytes.byteLength, it);
        frameBuffer.set(section.bytes, it.offset);
        it.offset += section.bytes.byteLength;
      }
    }

    return Buffer.from(frameBuffer.subarray(0, it.offset));
  },

  [Protocol.ERROR]: (code: number, message: string = '') => {
    // capacity: 1 + code varint + length-prefixed message
    ensureFrameCapacity(1 + 9 + 9 + Buffer.byteLength(message, "utf8"));

    it.offset = 1;
    frameBuffer[0] = Protocol.ERROR;

    encode.number(frameBuffer, code, it);
    encode.string(frameBuffer, message, it);

    return Buffer.from(frameBuffer.subarray(0, it.offset));
  },

  [Protocol.ROOM_STATE]: (bytes: number[]) => {
    return [Protocol.ROOM_STATE, ...bytes];
  },

  /**
   * Reply to a client {@link Protocol.ROOM_REQUEST}.
   *
   * Wire layout: `[ROOM_RESPONSE byte][requestId varint][status uint8][msgpack payload?]`
   *
   * `requestId` is opaque — echoed back exactly as the SDK sent it so the
   * pending callback/promise can be correlated. `status` is a
   * {@link ResponseStatus} (0 = OK, 1 = ERROR). The payload is omitted when a
   * handler resolves with `undefined`. Returns a fresh Buffer copy for the
   * same back-pressure reason documented on `raw` below.
   */
  [Protocol.ROOM_RESPONSE]: (requestId: number, status: number, message?: any): Buffer => {
    it.offset = 1;
    frameBuffer[0] = Protocol.ROOM_RESPONSE;

    encode.number(frameBuffer, requestId, it);
    frameBuffer[it.offset++] = status;
    const headerLength = it.offset;

    if (message !== undefined) {
      // reserve `headerLength` bytes up front in the pack output for the header
      const packed = packr.pack(message, RESERVE_START_SPACE | headerLength);
      packed.set(frameBuffer.subarray(0, headerLength), 0);
      return Buffer.from(packed);
    }

    return Buffer.from(frameBuffer.subarray(0, headerLength));
  },

  [Protocol.PING]: () => {
    frameBuffer[0] = Protocol.PING;
    return Buffer.from(frameBuffer.subarray(0, 1));
  },

  // Returns a fresh copy: frameBuffer/packr are reused next call, but callers pass
  // the result to async consumers (Node retains it for libuv writev across ticks).
  // See benchmark/test-buffer-corruption.ts for the back-pressure repro.
  raw: (code: Protocol, type: string | number, message?: any, rawMessage?: Uint8Array | Buffer): Buffer => {
    it.offset = 1;
    frameBuffer[0] = code;

    if (typeof (type) === 'string') {
      encode.string(frameBuffer, type, it);

    } else {
      encode.number(frameBuffer, type, it);
    }
    const headerLength = it.offset;

    if (message !== undefined) {
      // reserve `headerLength` bytes up front in the pack output for the header
      const packed = packr.pack(message, RESERVE_START_SPACE | headerLength);
      packed.set(frameBuffer.subarray(0, headerLength), 0);
      return Buffer.from(packed);

    } else if (rawMessage !== undefined) {
      ensureFrameCapacity(headerLength + rawMessage.byteLength);
      frameBuffer.set(rawMessage, headerLength);
      return Buffer.from(frameBuffer.subarray(0, headerLength + rawMessage.byteLength));

    } else {
      return Buffer.from(frameBuffer.subarray(0, headerLength));
    }
  },

};


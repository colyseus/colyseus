import { Packr } from '@colyseus/msgpackr';
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
  useRecords: false, // increased compatibility with decoders other than "msgpackr"
});

// msgpackr workaround: initialize buffer
packr.encode(undefined);

// Cached at module load so the per-send hot path avoids the `process.env`
// getter. The dev-only `packr.useBuffer` workaround below is gated by this.
const __isDev = process.env.NODE_ENV !== "production";

// Reused across `getMessageBytes` calls to avoid a per-call object allocation
// on the hot send path. `encode.string`/`encode.number` are leaf functions that
// mutate `.offset` in place and never call back into this module, so sharing is
// safe (Node's JS layer is single-threaded).
const it: Iterator = { offset: 0 };

export const getMessageBytes = {
  /**
   * Build the JOIN_ROOM payload.
   *
   * Wire layout:
   *   [JOIN_ROOM byte][rt-len][rt][sid-len][sid][stateReflection?][...sections]
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
    it.offset = 1;
    packr.buffer[0] = Protocol.JOIN_ROOM;

    packr.buffer[it.offset++] = Buffer.byteLength(reconnectionToken, "utf8");
    encode.utf8Write(packr.buffer, reconnectionToken, it);

    packr.buffer[it.offset++] = Buffer.byteLength(serializerId, "utf8");
    encode.utf8Write(packr.buffer, serializerId, it);

    let handshakeLength = handshake?.byteLength || 0;

    // upper-bound for sections: 1 byte tag + 9 bytes max varint + payload bytes
    let extraLength = 0;
    if (extraSections !== undefined) {
      for (let i = 0; i < extraSections.length; i++) {
        extraLength += 1 + 9 + extraSections[i].bytes.byteLength;
      }
    }

    // check if buffer needs to be resized
    const requiredCapacity = it.offset + handshakeLength + extraLength;
    if (requiredCapacity > packr.buffer.byteLength) {
      packr.useBuffer(Buffer.alloc(requiredCapacity, packr.buffer));
    }

    if (handshakeLength > 0) {
      packr.buffer.set(handshake, it.offset);
      it.offset += handshakeLength;
    }

    if (extraSections !== undefined) {
      for (let i = 0; i < extraSections.length; i++) {
        const section = extraSections[i];
        packr.buffer[it.offset++] = section.tag;
        encode.number(packr.buffer, section.bytes.byteLength, it);
        packr.buffer.set(section.bytes, it.offset);
        it.offset += section.bytes.byteLength;
      }
    }

    return Buffer.from(packr.buffer.subarray(0, it.offset));
  },

  [Protocol.ERROR]: (code: number, message: string = '') => {
    it.offset = 1;
    packr.buffer[0] = Protocol.ERROR;

    encode.number(packr.buffer, code, it);
    encode.string(packr.buffer, message, it);

    return Buffer.from(packr.buffer.subarray(0, it.offset));
  },

  [Protocol.ROOM_STATE]: (bytes: number[]) => {
    return [Protocol.ROOM_STATE, ...bytes];
  },

  [Protocol.PING]: () => {
    packr.buffer[0] = Protocol.PING;
    return Buffer.from(packr.buffer.subarray(0, 1));
  },

  // Each call returns a fresh Buffer copy because `packr.buffer` is shared
  // and reused on the next pack. Callers (transports / Room.broadcast) hand
  // the result to async consumers — Node `socket.write` retains it for libuv
  // writev across event-loop ticks, so a stable allocation is required for
  // correctness. See benchmark/test-buffer-corruption.ts for a wire-level
  // reproduction of the corruption that occurs without this copy under
  // sustained back-pressure (e.g. burst of 1000 × 4KB sends).
  raw: (code: Protocol, type: string | number, message?: any, rawMessage?: Uint8Array | Buffer): Buffer => {
    it.offset = 1;
    packr.buffer[0] = code;

    if (typeof (type) === 'string') {
      encode.string(packr.buffer, type, it);

    } else {
      encode.number(packr.buffer, type, it);
    }

    if (message !== undefined) {
      // force to encode from offset
      packr.position = 0;

      //
      // TODO: remove this after issue is fixed https://github.com/kriszyp/msgpackr/issues/139
      //
      // - This check is only required when running integration tests.
      //   (colyseus.js' usage of msgpackr/buffer is conflicting)
      //
      if (__isDev) {
        packr.useBuffer(packr.buffer);
      }

      // pack message into the same packr.buffer
      const endOfBufferOffset = packr.pack(message, 2048 + it.offset).byteLength;
                                                 // 2048 = RESERVE_START_SPACE
      return Buffer.from(packr.buffer.subarray(0, endOfBufferOffset));

    } else if (rawMessage !== undefined) {

      // check if buffer needs to be resized
      // TODO: can we avoid this?
      if (rawMessage.length + it.offset > packr.buffer.byteLength) {
        packr.useBuffer(Buffer.alloc(it.offset + rawMessage.length, packr.buffer));
      }

      // copy raw message into packr.buffer
      packr.buffer.set(rawMessage, it.offset);

      return Buffer.from(packr.buffer.subarray(0, it.offset + rawMessage.byteLength));

    } else {
      return Buffer.from(packr.buffer.subarray(0, it.offset));
    }
  },

};


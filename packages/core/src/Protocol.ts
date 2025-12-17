import { Packr } from '@colyseus/msgpackr';
import { encode, type Iterator } from '@colyseus/schema';

/**
 * Colyseus protocol codes range between 0~100
 */
export const Protocol = {
  // Room-related (10~19)
  JOIN_ROOM: 10,
  ERROR: 11,
  LEAVE_ROOM: 12,
  ROOM_DATA: 13,
  ROOM_STATE: 14,
  ROOM_STATE_PATCH: 15,
  // ROOM_DATA_SCHEMA: 16, // DEPRECATED: used to send schema instances via room.send()
  ROOM_DATA_BYTES: 17,
  PING: 18,
} as const;
export type Protocol = typeof Protocol[keyof typeof Protocol];

/**
 * WebSocket close codes
 * (See https://github.com/Luka967/websocket-close-codes)
 */
export const CloseCode = {
  NORMAL_CLOSURE: 1000,
  GOING_AWAY: 1001,
  NO_STATUS_RECEIVED: 1005,
  ABNORMAL_CLOSURE: 1006,

  CONSENTED: 4000,
  WITH_ERROR: 4002,
  DEVMODE_RESTART: 4010
} as const;
export type CloseCode = typeof CloseCode[keyof typeof CloseCode];

export const ErrorCode = {
  // HTTP MatchMaking Error Codes
  MATCHMAKE_NO_HANDLER: 520,
  MATCHMAKE_INVALID_CRITERIA: 521,
  MATCHMAKE_INVALID_ROOM_ID: 522,
  MATCHMAKE_UNHANDLED: 523, // generic exception during onCreate/onJoin
  MATCHMAKE_EXPIRED: 524, // generic exception during onCreate/onJoin
  AUTH_FAILED: 525,
  APPLICATION_ERROR: 526,

  INVALID_PAYLOAD: 4217,
} as const;
export type ErrorCode = typeof ErrorCode[keyof typeof ErrorCode];

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

export const getMessageBytes = {
  [Protocol.JOIN_ROOM]: (reconnectionToken: string, serializerId: string, handshake?: Buffer) => {
    const it: Iterator = { offset: 1 };
    packr.buffer[0] = Protocol.JOIN_ROOM;

    packr.buffer[it.offset++] = Buffer.byteLength(reconnectionToken, "utf8");
    encode.utf8Write(packr.buffer as Buffer, reconnectionToken, it);

    packr.buffer[it.offset++] = Buffer.byteLength(serializerId, "utf8");
    encode.utf8Write(packr.buffer as Buffer, serializerId, it);

    let handshakeLength = handshake?.byteLength || 0;

    // check if buffer needs to be resized
    if (handshakeLength > packr.buffer.byteLength - it.offset) {
      packr.useBuffer(Buffer.alloc(it.offset + handshakeLength, packr.buffer));
    }

    if (handshakeLength > 0) {
      handshake.copy(packr.buffer, it.offset, 0, handshakeLength);
    }

    return Buffer.from(packr.buffer.subarray(0, it.offset + handshakeLength));
  },

  [Protocol.ERROR]: (code: number, message: string = '') => {
    const it: Iterator = { offset: 1 };
    packr.buffer[0] = Protocol.ERROR;

    encode.number(packr.buffer as Buffer, code, it);
    encode.string(packr.buffer as Buffer, message, it);

    return Buffer.from(packr.buffer.subarray(0, it.offset));
  },

  [Protocol.ROOM_STATE]: (bytes: number[]) => {
    return [Protocol.ROOM_STATE, ...bytes];
  },

  [Protocol.PING]: () => {
    packr.buffer[0] = Protocol.PING;
    return Buffer.from(packr.buffer.subarray(0, 1));
  },

  raw: (code: Protocol, type: string | number, message?: any, rawMessage?: Uint8Array | Buffer) => {
    const it: Iterator = { offset: 1 };
    packr.buffer[0] = code;

    if (typeof (type) === 'string') {
      encode.string(packr.buffer as Buffer, type, it);

    } else {
      encode.number(packr.buffer as Buffer, type, it);
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
      if (process.env.NODE_ENV !== "production") {
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


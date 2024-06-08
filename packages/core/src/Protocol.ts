import { pack } from 'msgpackr';
import { encode, Iterator } from '@colyseus/schema';

// Colyseus protocol codes range between 0~100
export enum Protocol {
  // Room-related (10~19)
  JOIN_ROOM = 10,
  ERROR = 11,
  LEAVE_ROOM = 12,
  ROOM_DATA = 13,
  ROOM_STATE = 14,
  ROOM_STATE_PATCH = 15,
  // ROOM_DATA_SCHEMA = 16, // DEPRECATED: used to send schema instances via room.send()
  ROOM_DATA_BYTES = 17,

  // WebSocket close codes (https://github.com/Luka967/websocket-close-codes)
  WS_CLOSE_NORMAL = 1000,
  WS_CLOSE_GOING_AWAY = 1001,

  // WebSocket error codes
  WS_CLOSE_CONSENTED = 4000,
  WS_CLOSE_WITH_ERROR = 4002,
  WS_CLOSE_DEVMODE_RESTART = 4010,

  WS_SERVER_DISCONNECT = 4201,
  WS_TOO_MANY_CLIENTS = 4202,
}

export enum ErrorCode {
  // MatchMaking Error Codes
  MATCHMAKE_NO_HANDLER = 4210,
  MATCHMAKE_INVALID_CRITERIA = 4211,
  MATCHMAKE_INVALID_ROOM_ID = 4212,
  MATCHMAKE_UNHANDLED = 4213, // generic exception during onCreate/onJoin
  MATCHMAKE_EXPIRED = 4214, // generic exception during onCreate/onJoin

  AUTH_FAILED = 4215,
  APPLICATION_ERROR = 4216,

  INVALID_PAYLOAD = 4217,
}

// Inter-process communication protocol
export enum IpcProtocol {
  SUCCESS = 0,
  ERROR = 1,
  TIMEOUT = 2,
}

export const getMessageBytes = {
  [Protocol.JOIN_ROOM]: (reconnectionToken: string, serializerId: string, handshake?: number[] | Buffer) => {
    let offset = 0;

    const reconnectionTokenLength = Buffer.byteLength(reconnectionToken, "utf8");
    const serializerIdLength = Buffer.byteLength(serializerId, "utf8");
    const handshakeLength = (handshake) ? handshake.length : 0;

    const buff = Buffer.allocUnsafe(1 + reconnectionTokenLength + serializerIdLength + handshakeLength);
    buff.writeUInt8(Protocol.JOIN_ROOM, offset++);

    utf8Write(buff, offset, reconnectionToken);
    offset += reconnectionTokenLength;

    utf8Write(buff, offset, serializerId);
    offset += serializerIdLength;

    if (handshake) {
      for (let i = 0, l = handshake.length; i < l; i++) {
        buff.writeUInt8(handshake[i], offset++);
      }
    }

    return buff;
  },

  [Protocol.ERROR]: (code: number, message: string = '') => {
    const it: Iterator = { offset: 0 };
    const bytes = [Protocol.ERROR];

    encode.number(bytes, code, it);
    encode.string(bytes, message, it);

    return bytes;
  },

  [Protocol.ROOM_STATE]: (bytes: number[]) => {
    return [Protocol.ROOM_STATE, ...bytes];
  },

  raw: (code: Protocol, type: string | number, message?: any, rawMessage?: ArrayLike<number> | Buffer) => {
    const it: Iterator = { offset: 1 };
    const initialBytes: number[] = [code];

    if (typeof (type) === 'string') {
      encode.string(initialBytes, type as string, it);

    } else {
      encode.number(initialBytes, type, it);
    }

    let arr: Uint8Array;

    if (message !== undefined) {
      const encoded = pack(message);
      arr = new Uint8Array(initialBytes.length + encoded.byteLength);
      arr.set(new Uint8Array(initialBytes), 0);
      arr.set(new Uint8Array(encoded), initialBytes.length);

    } else if (rawMessage !== undefined) {
      arr = new Uint8Array(initialBytes.length + ((rawMessage as Buffer).byteLength || rawMessage.length));
      arr.set(new Uint8Array(initialBytes), 0);
      arr.set(new Uint8Array(rawMessage), initialBytes.length);

    } else {
      arr = new Uint8Array(initialBytes);
    }

    return arr;
  },

};

export function utf8Write(buff: Buffer, offset: number, str: string = '') {
  buff[offset++] = Buffer.byteLength(str, "utf8") - 1;

  let c = 0;
  for (let i = 0, l = str.length; i < l; i++) {
    c = str.charCodeAt(i);
    if (c < 0x80) {
      buff[offset++] = c;
    } else if (c < 0x800) {
      buff[offset++] = 0xc0 | (c >> 6);
      buff[offset++] = 0x80 | (c & 0x3f);
    } else if (c < 0xd800 || c >= 0xe000) {
      buff[offset++] = 0xe0 | (c >> 12);
      buff[offset++] = 0x80 | (c >> 6) & 0x3f;
      buff[offset++] = 0x80 | (c & 0x3f);
    } else {
      i++;
      c = 0x10000 + (((c & 0x3ff) << 10) | (str.charCodeAt(i) & 0x3ff));
      buff[offset++] = 0xf0 | (c >> 18);
      buff[offset++] = 0x80 | (c >> 12) & 0x3f;
      buff[offset++] = 0x80 | (c >> 6) & 0x3f;
      buff[offset++] = 0x80 | (c & 0x3f);
    }
  }
}

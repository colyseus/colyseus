import msgpack from 'notepack.io';

import { Schema } from '@colyseus/schema';
import * as encode from '@colyseus/schema/lib/encoding/encode';

// Colyseus protocol codes range between 0~100
export enum Protocol {
  // Room-related (10~19)
  JOIN_ROOM = 10,
  ERROR = 11,
  LEAVE_ROOM = 12,
  ROOM_DATA = 13,
  ROOM_STATE = 14,
  ROOM_STATE_PATCH = 15,
  ROOM_DATA_SCHEMA = 16, // used to send schema instances via room.send()

  // WebSocket close codes (https://github.com/Luka967/websocket-close-codes)
  WS_CLOSE_NORMAL = 1000,

  // WebSocket error codes
  WS_CLOSE_CONSENTED = 4000,
  WS_CLOSE_WITH_ERROR = 4002,
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
}

// Inter-process communication protocol
export enum IpcProtocol {
  SUCCESS = 0,
  ERROR = 1,
  TIMEOUT = 2,
}

export const getMessageBytes = {
  [Protocol.JOIN_ROOM]: (serializerId: string, handshake?: number[]) => {
    let offset = 0;

    const serializerIdLength = utf8Length(serializerId);
    const handshakeLength = (handshake) ? handshake.length : 0;

    const buff = Buffer.allocUnsafe(1 + serializerIdLength + handshakeLength);
    buff.writeUInt8(Protocol.JOIN_ROOM, offset++);

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
    const bytes = [Protocol.ERROR];

    encode.number(bytes, code);
    encode.string(bytes, message);

    return bytes;
  },

  [Protocol.ROOM_STATE]: (bytes: number[]) => {
    return [Protocol.ROOM_STATE, ...bytes];
  },

  [Protocol.ROOM_DATA_SCHEMA]: (message: Schema) => {
    const typeid = (message.constructor as typeof Schema)._typeid;

    if (typeid === undefined) {
      console.warn('Starting at colyseus >= 0.13 You must provide a type and message when calling `this.broadcast()` or `client.send()`. Please see: https://docs.colyseus.io/migrating/0.13/');
      throw new Error(`an instance of Schema was expected, but ${JSON.stringify(message)} has been provided.`);
    }

    return [Protocol.ROOM_DATA_SCHEMA, typeid, ...message.encodeAll()];
  },

  [Protocol.ROOM_DATA]: (type: string | number, message?: any) => {
    const initialBytes: number[] = [Protocol.ROOM_DATA];
    const messageType = typeof (type);

    if (messageType === 'string') {
      encode.string(initialBytes, type);

    } else if (messageType === 'number') {
      encode.number(initialBytes, type);

    } else {
      throw new Error(`Protocol.ROOM_DATA: message type not supported "${type.toString()}"`);
    }

    let arr: Uint8Array;

    if (message !== undefined) {
      const encoded = msgpack.encode(message);
      arr = new Uint8Array(initialBytes.length + encoded.byteLength);
      arr.set(new Uint8Array(initialBytes), 0);
      arr.set(new Uint8Array(encoded), initialBytes.length);

    } else {
      arr = new Uint8Array(initialBytes);
    }

    return arr;
  },
};

export function utf8Write(buff: Buffer, offset: number, str: string = '') {
  buff[offset++] = utf8Length(str) - 1;

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

// Faster for short strings than Buffer.byteLength
export function utf8Length(str: string = '') {
  let c = 0;
  let length = 0;
  for (let i = 0, l = str.length; i < l; i++) {
    c = str.charCodeAt(i);
    if (c < 0x80) {
      length += 1;
    } else if (c < 0x800) {
      length += 2;
    } else if (c < 0xd800 || c >= 0xe000) {
      length += 3;
    } else {
      i++;
      length += 4;
    }
  }
  return length + 1;
}

import msgpack from 'notepack.io';
import WebSocket from 'ws';

import { Client, ClientState } from './transport/Transport';
import { Schema } from '@colyseus/schema';
import * as encode from '@colyseus/schema/lib/encoding/encode';

// Colyseus protocol codes range between 0~100
export enum Protocol {
  // Room-related (10~19)
  JOIN_ROOM = 10,
  JOIN_ERROR = 11,
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

  // MatchMaking Error Codes
  ERR_MATCHMAKE_NO_HANDLER = 4210,
  ERR_MATCHMAKE_INVALID_CRITERIA = 4211,
  ERR_MATCHMAKE_INVALID_ROOM_ID = 4212,
  ERR_MATCHMAKE_UNHANDLED = 4213, // generic exception during onCreate/onJoin
  ERR_MATCHMAKE_EXPIRED = 4214, // generic exception during onCreate/onJoin
}

// Inter-process communication protocol
export enum IpcProtocol {
  SUCCESS = 0,
  ERROR = 1,
  TIMEOUT = 2,
}

// TODO: move `send[Protocol.xxx]` messages to `getMessageBytes[Protocol.xxx]()`.
export const send = {
  [Protocol.JOIN_ERROR]: (client: Client, message: string) => {
    if (client.readyState !== WebSocket.OPEN) { return; }
    const buff = Buffer.allocUnsafe(1 + utf8Length(message));
    buff.writeUInt8(Protocol.JOIN_ERROR, 0);
    utf8Write(buff, 1, message);
    client.raw(buff);
  },

  /**
   * TODO: refactor me. Move this to `SchemaSerializer` / `FossilDeltaSerializer`
   */
  [Protocol.ROOM_DATA]: (client: Client, message: any, encode: boolean = true) => {
    client.raw([Protocol.ROOM_DATA, ...(encode && msgpack.encode(message) || message)]);
  },

};

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

  [Protocol.ROOM_STATE]: (bytes: number[]) => {
    return [Protocol.ROOM_STATE, ...bytes];
  },

  [Protocol.ROOM_DATA_SCHEMA]: (message: Schema) => {
    return [
      Protocol.ROOM_DATA_SCHEMA,
      (message.constructor as typeof Schema)._typeid,
      ...message.encodeAll(),
    ]
  },

  [Protocol.ROOM_DATA]: (type: string | number, message: any) => {
    const encoded = msgpack.encode(message);
    const initialBytes: number[] = [Protocol.ROOM_DATA];

    if (typeof (type) === "string") {
      encode.string(initialBytes, type);

    } else {
      encode.number(initialBytes, type);
    }

    const arr = new Uint8Array(initialBytes.length + encoded.byteLength);
    arr.set(new Uint8Array(initialBytes), 0);
    arr.set(new Uint8Array(encoded), initialBytes.length);

    return arr;
  }
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

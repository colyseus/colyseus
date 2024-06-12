import { pack, Packr } from 'msgpackr';
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

const sendBuffer = Buffer.allocUnsafe(8192);
const packr = new Packr();
// @ts-ignore
packr.useBuffer(sendBuffer);

export const getMessageBytes = {
  [Protocol.JOIN_ROOM]: (reconnectionToken: string, serializerId: string, handshake?: Buffer) => {
    const it: Iterator = { offset: 1 };
    sendBuffer[0] = Protocol.JOIN_ROOM;

    utf8Write(sendBuffer, it, reconnectionToken);
    utf8Write(sendBuffer, it, serializerId);

    return Buffer.concat([sendBuffer.subarray(0, it.offset), handshake]);
  },

  [Protocol.ERROR]: (code: number, message: string = '') => {
    const it: Iterator = { offset: 1 };
    sendBuffer[0] = Protocol.ERROR;

    encode.number(sendBuffer, code, it);
    encode.string(sendBuffer, message, it);

    return sendBuffer.subarray(0, it.offset);
  },

  [Protocol.ROOM_STATE]: (bytes: number[]) => {
    return [Protocol.ROOM_STATE, ...bytes];
  },

  raw: (code: Protocol, type: string | number, message?: any, rawMessage?: Uint8Array | Buffer) => {
    const it: Iterator = { offset: 1 };
    sendBuffer[0] = code;

    if (typeof (type) === 'string') {
      encode.string(sendBuffer, type as string, it);

    } else {
      encode.number(sendBuffer, type, it);
    }

    if (message !== undefined) {
      // @ts-ignore
      return pack(message, 2048 + it.offset); // PR to fix TypeScript types https://github.com/kriszyp/msgpackr/pull/137
                        // 2048 = RESERVE_START_SPACE

    } else if (rawMessage !== undefined) {
      return Buffer.concat([sendBuffer.subarray(0, it.offset), rawMessage]);

    } else {
      return sendBuffer.subarray(0, it.offset);
    }
  },

};

export function utf8Write(buff: Buffer, it: Iterator, str: string = '') {
  const byteLength = Buffer.byteLength(str, "utf8");
  console.log("utf8Write", { byteLength, str });

  buff[it.offset++] = byteLength;

  let c = 0;
  for (let i = 0, l = str.length; i < l; i++) {
    c = str.charCodeAt(i);
    if (c < 0x80) {
      buff[it.offset++] = c;
    } else if (c < 0x800) {
      buff[it.offset++] = 0xc0 | (c >> 6);
      buff[it.offset++] = 0x80 | (c & 0x3f);
    } else if (c < 0xd800 || c >= 0xe000) {
      buff[it.offset++] = 0xe0 | (c >> 12);
      buff[it.offset++] = 0x80 | (c >> 6) & 0x3f;
      buff[it.offset++] = 0x80 | (c & 0x3f);
    } else {
      i++;
      c = 0x10000 + (((c & 0x3ff) << 10) | (str.charCodeAt(i) & 0x3ff));
      buff[it.offset++] = 0xf0 | (c >> 18);
      buff[it.offset++] = 0x80 | (c >> 12) & 0x3f;
      buff[it.offset++] = 0x80 | (c >> 6) & 0x3f;
      buff[it.offset++] = 0x80 | (c & 0x3f);
    }
  }

  it.offset += byteLength;
}

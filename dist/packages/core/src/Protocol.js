"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.utf8Length = exports.utf8Write = exports.getMessageBytes = exports.IpcProtocol = exports.ErrorCode = exports.Protocol = void 0;
const notepack_io_1 = __importDefault(require("notepack.io"));
const schema_1 = require("@colyseus/schema");
// Colyseus protocol codes range between 0~100
var Protocol;
(function (Protocol) {
    // Room-related (10~19)
    Protocol[Protocol["JOIN_ROOM"] = 10] = "JOIN_ROOM";
    Protocol[Protocol["ERROR"] = 11] = "ERROR";
    Protocol[Protocol["LEAVE_ROOM"] = 12] = "LEAVE_ROOM";
    Protocol[Protocol["ROOM_DATA"] = 13] = "ROOM_DATA";
    Protocol[Protocol["ROOM_STATE"] = 14] = "ROOM_STATE";
    Protocol[Protocol["ROOM_STATE_PATCH"] = 15] = "ROOM_STATE_PATCH";
    Protocol[Protocol["ROOM_DATA_SCHEMA"] = 16] = "ROOM_DATA_SCHEMA";
    // WebSocket close codes (https://github.com/Luka967/websocket-close-codes)
    Protocol[Protocol["WS_CLOSE_NORMAL"] = 1000] = "WS_CLOSE_NORMAL";
    // WebSocket error codes
    Protocol[Protocol["WS_CLOSE_CONSENTED"] = 4000] = "WS_CLOSE_CONSENTED";
    Protocol[Protocol["WS_CLOSE_WITH_ERROR"] = 4002] = "WS_CLOSE_WITH_ERROR";
    Protocol[Protocol["WS_SERVER_DISCONNECT"] = 4201] = "WS_SERVER_DISCONNECT";
    Protocol[Protocol["WS_TOO_MANY_CLIENTS"] = 4202] = "WS_TOO_MANY_CLIENTS";
})(Protocol = exports.Protocol || (exports.Protocol = {}));
var ErrorCode;
(function (ErrorCode) {
    // MatchMaking Error Codes
    ErrorCode[ErrorCode["MATCHMAKE_NO_HANDLER"] = 4210] = "MATCHMAKE_NO_HANDLER";
    ErrorCode[ErrorCode["MATCHMAKE_INVALID_CRITERIA"] = 4211] = "MATCHMAKE_INVALID_CRITERIA";
    ErrorCode[ErrorCode["MATCHMAKE_INVALID_ROOM_ID"] = 4212] = "MATCHMAKE_INVALID_ROOM_ID";
    ErrorCode[ErrorCode["MATCHMAKE_UNHANDLED"] = 4213] = "MATCHMAKE_UNHANDLED";
    ErrorCode[ErrorCode["MATCHMAKE_EXPIRED"] = 4214] = "MATCHMAKE_EXPIRED";
    ErrorCode[ErrorCode["AUTH_FAILED"] = 4215] = "AUTH_FAILED";
    ErrorCode[ErrorCode["APPLICATION_ERROR"] = 4216] = "APPLICATION_ERROR";
})(ErrorCode = exports.ErrorCode || (exports.ErrorCode = {}));
// Inter-process communication protocol
var IpcProtocol;
(function (IpcProtocol) {
    IpcProtocol[IpcProtocol["SUCCESS"] = 0] = "SUCCESS";
    IpcProtocol[IpcProtocol["ERROR"] = 1] = "ERROR";
    IpcProtocol[IpcProtocol["TIMEOUT"] = 2] = "TIMEOUT";
})(IpcProtocol = exports.IpcProtocol || (exports.IpcProtocol = {}));
exports.getMessageBytes = {
    [Protocol.JOIN_ROOM]: (serializerId, handshake) => {
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
    [Protocol.ERROR]: (code, message = '') => {
        const bytes = [Protocol.ERROR];
        schema_1.encode.number(bytes, code);
        schema_1.encode.string(bytes, message);
        return bytes;
    },
    [Protocol.ROOM_STATE]: (bytes) => {
        return [Protocol.ROOM_STATE, ...bytes];
    },
    [Protocol.ROOM_DATA_SCHEMA]: (message) => {
        const typeid = message.constructor._typeid;
        if (typeid === undefined) {
            console.warn('Starting at colyseus >= 0.13 You must provide a type and message when calling `this.broadcast()` or `client.send()`. Please see: https://docs.colyseus.io/migrating/0.13/');
            throw new Error(`an instance of Schema was expected, but ${JSON.stringify(message)} has been provided.`);
        }
        return [Protocol.ROOM_DATA_SCHEMA, typeid, ...message.encodeAll()];
    },
    [Protocol.ROOM_DATA]: (type, message) => {
        const initialBytes = [Protocol.ROOM_DATA];
        const messageType = typeof (type);
        if (messageType === 'string') {
            schema_1.encode.string(initialBytes, type);
        }
        else if (messageType === 'number') {
            schema_1.encode.number(initialBytes, type);
        }
        else {
            throw new Error(`Protocol.ROOM_DATA: message type not supported "${type.toString()}"`);
        }
        let arr;
        if (message !== undefined) {
            const encoded = notepack_io_1.default.encode(message);
            arr = new Uint8Array(initialBytes.length + encoded.byteLength);
            arr.set(new Uint8Array(initialBytes), 0);
            arr.set(new Uint8Array(encoded), initialBytes.length);
        }
        else {
            arr = new Uint8Array(initialBytes);
        }
        return arr;
    },
};
function utf8Write(buff, offset, str = '') {
    buff[offset++] = utf8Length(str) - 1;
    let c = 0;
    for (let i = 0, l = str.length; i < l; i++) {
        c = str.charCodeAt(i);
        if (c < 0x80) {
            buff[offset++] = c;
        }
        else if (c < 0x800) {
            buff[offset++] = 0xc0 | (c >> 6);
            buff[offset++] = 0x80 | (c & 0x3f);
        }
        else if (c < 0xd800 || c >= 0xe000) {
            buff[offset++] = 0xe0 | (c >> 12);
            buff[offset++] = 0x80 | (c >> 6) & 0x3f;
            buff[offset++] = 0x80 | (c & 0x3f);
        }
        else {
            i++;
            c = 0x10000 + (((c & 0x3ff) << 10) | (str.charCodeAt(i) & 0x3ff));
            buff[offset++] = 0xf0 | (c >> 18);
            buff[offset++] = 0x80 | (c >> 12) & 0x3f;
            buff[offset++] = 0x80 | (c >> 6) & 0x3f;
            buff[offset++] = 0x80 | (c & 0x3f);
        }
    }
}
exports.utf8Write = utf8Write;
// Faster for short strings than Buffer.byteLength
function utf8Length(str = '') {
    let c = 0;
    let length = 0;
    for (let i = 0, l = str.length; i < l; i++) {
        c = str.charCodeAt(i);
        if (c < 0x80) {
            length += 1;
        }
        else if (c < 0x800) {
            length += 2;
        }
        else if (c < 0xd800 || c >= 0xe000) {
            length += 3;
        }
        else {
            i++;
            length += 4;
        }
    }
    return length + 1;
}
exports.utf8Length = utf8Length;
//# sourceMappingURL=Protocol.js.map
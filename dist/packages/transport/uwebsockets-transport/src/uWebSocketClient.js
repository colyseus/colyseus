"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.uWebSocketClient = exports.ReadyState = exports.uWebSocketWrapper = void 0;
const events_1 = __importDefault(require("events"));
const core_1 = require("@colyseus/core");
const schema_1 = require("@colyseus/schema");
class uWebSocketWrapper extends events_1.default {
    constructor(ws) {
        super();
        this.ws = ws;
    }
}
exports.uWebSocketWrapper = uWebSocketWrapper;
var ReadyState;
(function (ReadyState) {
    ReadyState[ReadyState["CONNECTING"] = 0] = "CONNECTING";
    ReadyState[ReadyState["OPEN"] = 1] = "OPEN";
    ReadyState[ReadyState["CLOSING"] = 2] = "CLOSING";
    ReadyState[ReadyState["CLOSED"] = 3] = "CLOSED";
})(ReadyState = exports.ReadyState || (exports.ReadyState = {}));
class uWebSocketClient {
    constructor(id, ref) {
        this.id = id;
        this.ref = ref;
        this.state = core_1.ClientState.JOINING;
        this._enqueuedMessages = [];
        this.readyState = ReadyState.OPEN;
        this.sessionId = id;
        ref.on('close', () => this.readyState = ReadyState.CLOSED);
    }
    send(messageOrType, messageOrOptions, options) {
        this.enqueueRaw((messageOrType instanceof schema_1.Schema)
            ? core_1.getMessageBytes[core_1.Protocol.ROOM_DATA_SCHEMA](messageOrType)
            : core_1.getMessageBytes[core_1.Protocol.ROOM_DATA](messageOrType, messageOrOptions), options);
    }
    enqueueRaw(data, options) {
        // use room's afterNextPatch queue
        if (options?.afterNextPatch) {
            this._afterNextPatchQueue.push([this, arguments]);
            return;
        }
        if (this.state === core_1.ClientState.JOINING) {
            // sending messages during `onJoin`.
            // - the client-side cannot register "onMessage" callbacks at this point.
            // - enqueue the messages to be send after JOIN_ROOM message has been sent
            this._enqueuedMessages.push(data);
            return;
        }
        this.raw(data, options);
    }
    raw(data, options, cb) {
        if (this.readyState !== ReadyState.OPEN) {
            console.warn('trying to send data to inactive client', this.sessionId);
            return;
        }
        this.ref.ws.send(new Uint8Array(data), true, false);
    }
    error(code, message = '', cb) {
        this.raw(core_1.getMessageBytes[core_1.Protocol.ERROR](code, message), undefined, cb);
    }
    leave(code, data) {
        if (this.readyState !== ReadyState.OPEN) {
            // connection already closed. ignore.
            return;
        }
        this.readyState = ReadyState.CLOSING;
        if (code !== undefined) {
            this.ref.ws.end(code, data);
        }
        else {
            this.ref.ws.close();
        }
    }
    close(code, data) {
        console.warn('DEPRECATION WARNING: use client.leave() instead of client.close()');
        try {
            throw new Error();
        }
        catch (e) {
            console.log(e.stack);
        }
        this.leave(code, data);
    }
    toJSON() {
        return { sessionId: this.sessionId, readyState: this.readyState };
    }
}
exports.uWebSocketClient = uWebSocketClient;
//# sourceMappingURL=uWebSocketClient.js.map
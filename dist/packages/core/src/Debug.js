"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.debugAndPrintError = exports.debugPresence = exports.debugDriver = exports.debugConnection = exports.debugError = exports.debugPatch = exports.debugMatchMaking = void 0;
const debug_1 = __importDefault(require("debug"));
const ServerError_1 = require("./errors/ServerError");
exports.debugMatchMaking = debug_1.default('colyseus:matchmaking');
exports.debugPatch = debug_1.default('colyseus:patch');
exports.debugError = debug_1.default('colyseus:errors');
exports.debugConnection = debug_1.default('colyseus:connection');
exports.debugDriver = debug_1.default('colyseus:driver');
exports.debugPresence = debug_1.default('colyseus:presence');
const debugAndPrintError = (e) => {
    const message = (e instanceof Error) ? e.stack : e;
    if (!(e instanceof ServerError_1.ServerError)) {
        console.error(message);
    }
    exports.debugError.call(exports.debugError, message);
};
exports.debugAndPrintError = debugAndPrintError;
//# sourceMappingURL=Debug.js.map
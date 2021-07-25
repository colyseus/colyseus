"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ServerError = void 0;
const Protocol_1 = require("../Protocol");
class ServerError extends Error {
    constructor(code = Protocol_1.ErrorCode.MATCHMAKE_UNHANDLED, message) {
        super(message);
        // Maintains proper stack trace for where our error was thrown (only available on V8)
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, ServerError);
        }
        this.name = 'ServerError';
        this.code = code;
    }
}
exports.ServerError = ServerError;
//# sourceMappingURL=ServerError.js.map
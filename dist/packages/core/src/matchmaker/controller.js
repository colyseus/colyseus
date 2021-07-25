"use strict";
/**
 * Matchmaking controller
 * (for interoperability between different http frameworks, e.g. express, uWebSockets.js, etc)
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.invokeMethod = exports.getAvailableRooms = void 0;
const Protocol_1 = require("../Protocol");
const ServerError_1 = require("../errors/ServerError");
const matchMaker = __importStar(require("../MatchMaker"));
const exposedMethods = ['joinOrCreate', 'create', 'join', 'joinById'];
const allowedRoomNameChars = /([a-zA-Z_\-0-9]+)/gi;
const matchmakeRoute = 'matchmake';
function getAvailableRooms(roomName) {
    /**
    * list public & unlocked rooms
    */
    const conditions = {
        locked: false,
        private: false,
        name: roomName,
    };
    return matchMaker.query(conditions);
}
exports.getAvailableRooms = getAvailableRooms;
async function invokeMethod(method, roomName, clientOptions = {}) {
    if (exposedMethods.indexOf(method) === -1) {
        throw new ServerError_1.ServerError(Protocol_1.ErrorCode.MATCHMAKE_NO_HANDLER, `invalid method "${method}"`);
    }
    try {
        return await matchMaker[method](roomName, clientOptions);
    }
    catch (e) {
        throw new ServerError_1.ServerError(e.code || Protocol_1.ErrorCode.MATCHMAKE_UNHANDLED, e.message);
    }
}
exports.invokeMethod = invokeMethod;
//# sourceMappingURL=controller.js.map
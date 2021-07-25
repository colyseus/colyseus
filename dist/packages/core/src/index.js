"use strict";
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
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RelayRoom = exports.LobbyRoom = exports.debugAndPrintError = exports.debugPresence = exports.debugDriver = exports.debugConnection = exports.debugError = exports.debugPatch = exports.debugMatchMaking = exports.spliceOne = exports.Deferred = exports.generateId = exports.Delayed = exports.Clock = exports.SchemaSerializer = exports.LocalPresence = exports.Transport = exports.ClientState = exports.subscribeLobby = exports.updateLobby = exports.matchMaker = exports.ServerError = exports.RegisteredHandler = exports.getMessageBytes = exports.ErrorCode = exports.Protocol = exports.RoomInternalState = exports.Room = exports.Server = void 0;
const timer_1 = __importStar(require("@gamestdio/timer"));
exports.Clock = timer_1.default;
Object.defineProperty(exports, "Delayed", { enumerable: true, get: function () { return timer_1.Delayed; } });
// Core classes
var Server_1 = require("./Server");
Object.defineProperty(exports, "Server", { enumerable: true, get: function () { return Server_1.Server; } });
var Room_1 = require("./Room");
Object.defineProperty(exports, "Room", { enumerable: true, get: function () { return Room_1.Room; } });
Object.defineProperty(exports, "RoomInternalState", { enumerable: true, get: function () { return Room_1.RoomInternalState; } });
var Protocol_1 = require("./Protocol");
Object.defineProperty(exports, "Protocol", { enumerable: true, get: function () { return Protocol_1.Protocol; } });
Object.defineProperty(exports, "ErrorCode", { enumerable: true, get: function () { return Protocol_1.ErrorCode; } });
Object.defineProperty(exports, "getMessageBytes", { enumerable: true, get: function () { return Protocol_1.getMessageBytes; } });
var RegisteredHandler_1 = require("./matchmaker/RegisteredHandler");
Object.defineProperty(exports, "RegisteredHandler", { enumerable: true, get: function () { return RegisteredHandler_1.RegisteredHandler; } });
var ServerError_1 = require("./errors/ServerError");
Object.defineProperty(exports, "ServerError", { enumerable: true, get: function () { return ServerError_1.ServerError; } });
// MatchMaker
const matchMaker = __importStar(require("./MatchMaker"));
exports.matchMaker = matchMaker;
var Lobby_1 = require("./matchmaker/Lobby");
Object.defineProperty(exports, "updateLobby", { enumerable: true, get: function () { return Lobby_1.updateLobby; } });
Object.defineProperty(exports, "subscribeLobby", { enumerable: true, get: function () { return Lobby_1.subscribeLobby; } });
// Driver
__exportStar(require("./matchmaker/driver"), exports);
// Transport
var Transport_1 = require("./Transport");
Object.defineProperty(exports, "ClientState", { enumerable: true, get: function () { return Transport_1.ClientState; } });
Object.defineProperty(exports, "Transport", { enumerable: true, get: function () { return Transport_1.Transport; } });
var LocalPresence_1 = require("./presence/LocalPresence");
Object.defineProperty(exports, "LocalPresence", { enumerable: true, get: function () { return LocalPresence_1.LocalPresence; } });
var SchemaSerializer_1 = require("./serializer/SchemaSerializer");
Object.defineProperty(exports, "SchemaSerializer", { enumerable: true, get: function () { return SchemaSerializer_1.SchemaSerializer; } });
var Utils_1 = require("./Utils");
Object.defineProperty(exports, "generateId", { enumerable: true, get: function () { return Utils_1.generateId; } });
Object.defineProperty(exports, "Deferred", { enumerable: true, get: function () { return Utils_1.Deferred; } });
Object.defineProperty(exports, "spliceOne", { enumerable: true, get: function () { return Utils_1.spliceOne; } });
// Debug
var Debug_1 = require("./Debug");
Object.defineProperty(exports, "debugMatchMaking", { enumerable: true, get: function () { return Debug_1.debugMatchMaking; } });
Object.defineProperty(exports, "debugPatch", { enumerable: true, get: function () { return Debug_1.debugPatch; } });
Object.defineProperty(exports, "debugError", { enumerable: true, get: function () { return Debug_1.debugError; } });
Object.defineProperty(exports, "debugConnection", { enumerable: true, get: function () { return Debug_1.debugConnection; } });
Object.defineProperty(exports, "debugDriver", { enumerable: true, get: function () { return Debug_1.debugDriver; } });
Object.defineProperty(exports, "debugPresence", { enumerable: true, get: function () { return Debug_1.debugPresence; } });
Object.defineProperty(exports, "debugAndPrintError", { enumerable: true, get: function () { return Debug_1.debugAndPrintError; } });
// Default rooms
var LobbyRoom_1 = require("./rooms/LobbyRoom");
Object.defineProperty(exports, "LobbyRoom", { enumerable: true, get: function () { return LobbyRoom_1.LobbyRoom; } });
var RelayRoom_1 = require("./rooms/RelayRoom");
Object.defineProperty(exports, "RelayRoom", { enumerable: true, get: function () { return RelayRoom_1.RelayRoom; } });
//# sourceMappingURL=index.js.map
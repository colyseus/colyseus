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
Object.defineProperty(exports, "__esModule", { value: true });
exports.subscribeLobby = exports.updateLobby = void 0;
const matchMaker = __importStar(require("../MatchMaker"));
const LOBBY_CHANNEL = '$lobby';
function updateLobby(room, removed = false) {
    const listing = room.listing;
    if (!listing.unlisted && !listing.private) {
        matchMaker.presence.publish(LOBBY_CHANNEL, `${listing.roomId},${removed ? 1 : 0}`);
    }
}
exports.updateLobby = updateLobby;
async function subscribeLobby(callback) {
    const cb = async (message) => {
        const [roomId, isRemove] = message.split(',');
        if (isRemove === '1') {
            callback(roomId, null);
        }
        else {
            const room = (await matchMaker.query({ roomId }))[0];
            callback(roomId, room);
        }
    };
    await matchMaker.presence.subscribe(LOBBY_CHANNEL, cb);
    return () => matchMaker.presence.unsubscribe(LOBBY_CHANNEL, cb);
}
exports.subscribeLobby = subscribeLobby;
//# sourceMappingURL=Lobby.js.map
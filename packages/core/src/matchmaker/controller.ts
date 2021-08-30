/**
 * Matchmaking controller 
 * (for interoperability between different http frameworks, e.g. express, uWebSockets.js, etc)
 */

import { ErrorCode } from "../Protocol";
import { ServerError } from "../errors/ServerError";
import * as matchMaker from "../MatchMaker";

const exposedMethods = ['joinOrCreate', 'create', 'join', 'joinById'];
const allowedRoomNameChars = /([a-zA-Z_\-0-9]+)/gi;
const matchmakeRoute = 'matchmake';

export function getAvailableRooms(roomName: string) {
    /**
    * list public & unlocked rooms
    */
    const conditions: any = {
        locked: false,
        private: false,
    };
    if (roomName) {
        conditions["name"] = roomName;
    }
    return matchMaker.query(conditions);
}

export async function invokeMethod(method: string, roomName: string, clientOptions: any = {}) {
    if (exposedMethods.indexOf(method) === -1) {
        throw new ServerError(ErrorCode.MATCHMAKE_NO_HANDLER, `invalid method "${method}"`);
    }

    try {
        return await matchMaker[method](roomName, clientOptions);

    } catch (e) {
        throw new ServerError(e.code || ErrorCode.MATCHMAKE_UNHANDLED, e.message);
    }
}

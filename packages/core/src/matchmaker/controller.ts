/**
 * Matchmaking controller
 * (for interoperability between different http frameworks, e.g. express, uWebSockets.js, etc)
 */

import { ServerError } from '../errors/ServerError';
import * as matchMaker from '../MatchMaker';
import { ErrorCode } from '../Protocol';

export default {
  DEFAULT_CORS_HEADERS: {
    'Access-Control-Allow-Headers': 'Origin, X-Requested-With, Content-Type, Accept',
    'Access-Control-Allow-Methods': 'OPTIONS, POST, GET',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Max-Age': '2592000',
    // ...
  },

  allowedRoomNameChars: /([a-zA-Z_\-0-9]+)/gi,
  exposedMethods: ['joinOrCreate', 'create', 'join', 'joinById', 'reconnect'],
  matchmakeRoute: 'matchmake',

  /**
   * You can manually change the default corsHeaders by overwriting the `getCorsHeaders()` method:
   *    ```
   *    import { matchMaker } from "@colyseus/core";
   *    matchMaker.controller.getCorsHeaders = function(req) {
   *      if (req.headers.referer !== "xxx") {
   *      }
   *
   *      return {
   *        'Access-Control-Allow-Origin': 'safedomain.com',
   *      }
   *    }
   *    ```
   */
  getCorsHeaders(request: any): { [header: string]: string } {
    return {};
  },

  getAvailableRooms(roomName: string) {
    /**
     * list public & unlocked rooms
     */
    const conditions: any = {
      locked: false,
      private: false,
    };
    if (roomName) {
      conditions.name = roomName;
    }
    return matchMaker.query(conditions);
  },

  async invokeMethod(method: string, roomName: string, clientOptions: any = {}) {
    if (this.exposedMethods.indexOf(method) === -1) {
      throw new ServerError(ErrorCode.MATCHMAKE_NO_HANDLER, `invalid method "${method}"`);
    }

    try {
      return await matchMaker[method](roomName, clientOptions);

    } catch (e) {
      throw new ServerError(e.code || ErrorCode.MATCHMAKE_UNHANDLED, e.message);
    }
  },

};

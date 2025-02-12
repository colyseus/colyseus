/**
 * Matchmaking controller
 * (for interoperability between different http frameworks, e.g. express, uWebSockets.js, etc)
 */

import { IncomingMessage } from 'http';
import { ErrorCode } from '../Protocol.js';
import { ServerError } from '../errors/ServerError.js';
import * as matchMaker from '../MatchMaker.js';
import type { AuthContext } from '../Transport.js';

export default {
  DEFAULT_CORS_HEADERS: {
    'Access-Control-Allow-Headers': 'Origin, X-Requested-With, Content-Type, Accept, Authorization',
    'Access-Control-Allow-Methods': 'OPTIONS, POST, GET',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Max-Age': '2592000',
    // ...
  },

  exposedMethods: ['joinOrCreate', 'create', 'join', 'joinById', 'reconnect'],
  allowedRoomNameChars: /([a-zA-Z_\-0-9]+)/gi,
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
  getCorsHeaders(req: IncomingMessage): { [header: string]: string } {
    const origin = (req.headers && req.headers['origin']) || (req as any).getHeader && (req as any).getHeader('origin');
    return {
      ['Access-Control-Allow-Origin']: origin || "*",
    };
  },

  async invokeMethod(
    method: string,
    roomName: string,
    clientOptions: matchMaker.ClientOptions = {},
    authOptions?: AuthContext,
  ) {
    if (this.exposedMethods.indexOf(method) === -1) {
      throw new ServerError(ErrorCode.MATCHMAKE_NO_HANDLER, `invalid method "${method}"`);
    }

    try {
      return await matchMaker[method](roomName, clientOptions, authOptions);

    } catch (e) {
      throw new ServerError(e.code || ErrorCode.MATCHMAKE_UNHANDLED, e.message);
    }
  }

}


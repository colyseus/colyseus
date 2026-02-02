/**
 * Matchmaking controller
 * (for interoperability between different http frameworks, e.g. express, uWebSockets.js, etc)
 */

import { ErrorCode } from '@colyseus/shared-types';
import { ServerError } from '../errors/ServerError.ts';
import { debugError } from '../Debug.ts';
import * as matchMaker from '../MatchMaker.ts';
import type { AuthContext } from '../Transport.ts';

export const controller = {
  DEFAULT_CORS_HEADERS: {
    'Access-Control-Allow-Headers': 'Origin, X-Requested-With, Content-Type, Accept, Authorization',
    'Access-Control-Allow-Methods': 'GET,HEAD,PUT,PATCH,POST,DELETE',
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
   *    matchMaker.controller.getCorsHeaders = function(headers) {
   *      if (headers.get('referer') !== "xxx") {
   *      }
   *
   *      return {
   *        'Access-Control-Allow-Origin': 'safedomain.com',
   *      }
   *    }
   *    ```
   */
  getCorsHeaders(headers: Headers): { [header: string]: string } {
    return {
      ['Access-Control-Allow-Origin']: headers.get("origin") || "*",
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

    } catch (e: any) {
      debugError(e);
      throw new ServerError(e.code || ErrorCode.MATCHMAKE_UNHANDLED, e.message);
    }
  }

}


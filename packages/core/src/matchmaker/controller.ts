/**
 * Matchmaking controller
 * (for interoperability between different http frameworks, e.g. express, uWebSockets.js, etc)
 */

import { ErrorCode } from '@colyseus/shared-types';
import { ServerError } from '../errors/ServerError.ts';
import { debugError } from '../Debug.ts';
import * as matchMaker from '../MatchMaker.ts';
import type { AuthContext } from '../Transport.ts';
import type { Status } from '@colyseus/better-call';

// with `standardHttpStatus`; 503 (shutting down) is already standard
const STANDARD_HTTP_STATUS: { [code: number]: Status } = {
  [ErrorCode.MATCHMAKE_NO_HANDLER]: 404,
  [ErrorCode.MATCHMAKE_INVALID_CRITERIA]: 404,
  [ErrorCode.MATCHMAKE_INVALID_ROOM_ID]: 404,
  [ErrorCode.MATCHMAKE_UNHANDLED]: 500,
  [ErrorCode.MATCHMAKE_EXPIRED]: 410,
  [ErrorCode.AUTH_FAILED]: 401,
  [ErrorCode.APPLICATION_ERROR]: 500,
};

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
   * Respond to a failed matchmaking request with a standard HTTP status
   * (404, 401, 410, 500) instead of its `ErrorCode`, whose 520–526 values sit
   * in Cloudflare's reserved range. The body carries the `ErrorCode` either way.
   *
   * Off by default in 0.18: clients that read the code from the status get
   * 404 instead of 522. Enable it once yours read it from the body
   * (`@colyseus/sdk` 0.18.10 or later). Colyseus 1.0 always behaves this way.
   *
   * See https://github.com/colyseus/colyseus/issues/999
   */
  standardHttpStatus: false,

  /**
   * The HTTP status for a matchmaking request that failed with `code`.
   * Anything that isn't an HTTP error status becomes 500.
   */
  getHttpStatus(code: number): Status {
    return (this.standardHttpStatus && STANDARD_HTTP_STATUS[code])
      || ((Number.isInteger(code) && code >= 400 && code <= 599) ? code as Status : 500);
  },

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
      // a driver's string code (e.g. "ECONNREFUSED") isn't an ErrorCode either
      throw new ServerError((typeof e.code === "number" && e.code) || ErrorCode.MATCHMAKE_UNHANDLED, e.message);
    }
  }

}


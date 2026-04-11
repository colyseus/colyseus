/**
 * Raw Node.js adapter for Colyseus matchmaking routes used by `colyseus/vite`.
 *
 * This file exists specifically so the Vite plugin can share Vite's dev HTTP
 * server while still exposing the Colyseus `/matchmake/*` endpoints.
 *
 * Keep the matchmaking behavior itself in `router/default_routes.ts` and use
 * this file only as the thin raw Node/Express adapter around it.
 */
import type http from 'http';
import { URL } from 'url';
import * as matchMaker from '../MatchMaker.ts';
import { setResponse } from '@colyseus/better-call/node';
import { postMatchmakeMethod } from './default_routes.ts';

function readBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let data = '';

    req.on('data', (chunk: Buffer | string) => {
      data += chunk.toString();
    });
    req.on('end', () => resolve(data ? JSON.parse(data) : {}));
    req.on('error', reject);
  });
}

function getCorsHeaders(req: http.IncomingMessage, headers?: Headers): Record<string, string> {
  return {
    ...matchMaker.controller.DEFAULT_CORS_HEADERS,
    ...matchMaker.controller.getCorsHeaders(headers),
  };
}

export function createNodeMatchmakingMiddleware() {
  return async (
    req: http.IncomingMessage,
    res: http.ServerResponse,
    next: () => void,
  ) => {
    const url = new URL(req.url || '/', 'http://localhost');
    const isMatchmakeRoute = url.pathname.startsWith(`/${matchMaker.controller.matchmakeRoute}/`);

    if (!isMatchmakeRoute) {
      next();
      return;
    }

    const headers = new Headers(req.headers as Record<string, string>);
    const corsHeaders = getCorsHeaders(req, headers);

    if (req.method === 'OPTIONS') {
      res.writeHead(204, corsHeaders);
      res.end();
      return;
    }

    if (req.method !== 'POST') {
      next();
      return;
    }

    const match = url.pathname.match(/^\/matchmake\/(\w+)\/(.+)/);
    if (!match) {
      next();
      return;
    }

    const [, method, roomName] = match;

    try {
      const response = await postMatchmakeMethod({
        params: { method, roomName },
        body: await readBody(req),
        headers: req.headers as Record<string, string>,
        request: { headers } as any,
        asResponse: true,
      });

      await setResponse(res, response);

    } catch {
      // Endpoint-level failures are returned as Response when `asResponse` is true.
      // Any thrown error here is unexpected, so let the next middleware decide.
      next();
    }
  };
}

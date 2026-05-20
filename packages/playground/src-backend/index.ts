import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import type { IncomingMessage, ServerResponse } from 'http';
import { createEndpoint, dualModeEndpoints, isDevMode, matchMaker, Server, type IRoomCache, type Endpoint } from '@colyseus/core';
import { auth, JWT } from '@colyseus/auth';
import { applyMonkeyPatch } from './colyseus.ext.js';
import { serveStatic } from './serve-static.js';

export type AuthConfig = {
  oauth: string[],
  register: boolean,
  anonymous: boolean,
};

export interface PlaygroundOptions {
  /** Mount prefix used when spread into `createRouter`. Ignored in express-middleware mode (express strips its mount path). Defaults to `''`. */
  prefix?: string;
  /** Better-call middleware applied to every playground endpoint — use for auth gating. */
  use?: any[];
}

const SPA_DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'build');

export function playground(opts: PlaygroundOptions = {}) {
  applyMonkeyPatch();

  const prefix = opts.prefix ?? '';
  const use = opts.use ?? [];

  const endpoints: Record<string, Endpoint> = {
    'playground-rooms': createEndpoint(`${prefix}/rooms`, { method: 'GET', use }, async () => {
      const rooms = await matchMaker.driver.query({});
      const roomsByType: Record<string, number> = {};
      const roomsById: Record<string, IRoomCache> = {};
      rooms.forEach((room) => {
        roomsByType[room.name] = (roomsByType[room.name] ?? 0) + 1;
        roomsById[room.roomId] = room;
      });
      return {
        rooms: Object.keys(matchMaker.getAllHandlers()),
        roomsByType,
        roomsById,
        auth: {
          oauth: Object.keys(auth.oauth.providers),
          register: typeof auth.settings.onRegisterWithEmailAndPassword === 'function',
          anonymous: typeof JWT.settings.secret === 'string',
        } as AuthConfig,
      };
    }),

    'playground-apidocs': createEndpoint(`${prefix}/__apidocs`, { method: 'GET', use }, async () => {
      // Dumps every route + Zod schema, so an unguarded public mount leaks
      // the whole API surface. Refuse only the accidental case: not devMode
      // AND no `use:` guard. A guard is the opt-in for prod use. 404 hides
      // the route's existence.
      if (!isDevMode && use.length === 0) {
        return new Response('Not found', { status: 404 });
      }

      let z: any;
      try { z = await import('zod'); } catch { /* zod is an optional peer */ }
      const routerEndpoints: Record<string, any> = (Server.current?.router as any)?.endpoints ?? {};
      return Object.values(routerEndpoints).map((endpoint: any) => ({
        method: endpoint.options.method,
        path: endpoint.path,
        body: z && endpoint.options.body && z.toJSONSchema(endpoint.options.body),
        query: z && endpoint.options.query && z.toJSONSchema(endpoint.options.query),
        metadata: endpoint.options.metadata,
        description: endpoint.options.metadata?.openapi?.description,
      }));
    }),

    'playground-index': createEndpoint(`${prefix}/`, { method: 'GET', use }, async () => {
      return serveStatic(SPA_DIST, '');
    }),

    'playground-static': createEndpoint(`${prefix}/**:splat`, { method: 'GET', use }, async (ctx) => {
      return serveStatic(SPA_DIST, (ctx.params as any).splat);
    }),
  };

  const SPA_DIST_RESOLVED = path.resolve(SPA_DIST);

  return dualModeEndpoints(endpoints, {
    catchAllKey: 'playground-static',
    buildMiddleware: ({ fullHandler }) => {
      // Strip express's `baseUrl` so the inner router sees the request
      // relative to its mount point — playground's endpoint paths assume
      // a `''` prefix, so a sub-mount like `app.use("/foo", playground())`
      // needs the leading `/foo` stripped before dispatch.
      const dispatch = (req: IncomingMessage, res: ServerResponse, next: (e?: any) => void) => {
        const stripped = Object.create(req, {
          baseUrl: { value: '', enumerable: true, configurable: true },
          originalUrl: { value: req.url, enumerable: true, configurable: true },
        });
        fullHandler(stripped as any, res as any).catch(next);
      };

      return (req, res, next) => {
        if (req.method !== 'GET') { return next(); }
        const url = (req.url ?? '').split('?')[0]!;

        if (url === '/' || url === '/rooms' || url === '/__apidocs') {
          return dispatch(req, res, next);
        }

        // Asset request — only delegate if the file actually exists on
        // disk. Avoids the catch-all's SPA fallback (which would serve
        // index.html for unknown paths, masking sibling express routes).
        const rel = url.replace(/^\/+/, '');
        if (!rel || rel.includes('..')) { return next(); }
        const filePath = path.resolve(SPA_DIST_RESOLVED, rel);
        if (!filePath.startsWith(SPA_DIST_RESOLVED + path.sep)) { return next(); }

        fs.stat(filePath).then((stat) => {
          if (stat.isFile()) {
            dispatch(req, res, next);
          } else {
            next();
          }
        }).catch(() => next());
      };
    },
  });
}
